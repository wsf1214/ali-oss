
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Readable } = require('stream');
const utils = require('./utils');
const oss = require('../..');
const config = require('../config').oss;
const urllib = require('urllib');
const copy = require('copy-to');
const mm = require('mm');
const streamEqual = require('stream-equal');
const crypto = require('crypto');
const urlutil = require('url');

const tmpdir = path.join(__dirname, '.tmp');
if (!fs.existsSync(tmpdir)) {
  fs.mkdirSync(tmpdir);
}

describe('test/object.test.js', () => {
  const { prefix } = utils;

  before(async () => {
    this.store = oss(config);
    this.bucket = `ali-oss-test-object-bucket-${prefix.replace(/[/.]/g, '-')}`;
    this.bucket = this.bucket.substring(0, this.bucket.length - 1);

    // just for archive bucket test
    this.archvieBucket = `oss-archvie-bucket-${prefix.replace(/[/.]/g, '-')}`;
    this.archvieBucket = this.archvieBucket.substring(0, this.archvieBucket.length - 1);

    this.region = config.region;
    // console.log('current buckets: %j',
    //   (yield this.store.listBuckets()).buckets.map(function (item) {
    //     return item.name + ':' + item.region;
    //   })
    // );
    await this.store.putBucket(this.bucket, this.region);
    this.store.useBucket(this.bucket, this.region);

    await this.store.putBucket(this.archvieBucket, this.region, { StorageClass: 'Archive' });
    // this.store.useBucket(this.archvieBucket, this.region);
  });

  after(async () => {
    await utils.cleanBucket(this.store, this.bucket, this.region);
    await utils.cleanBucket(this.store, this.archvieBucket, this.region);
  });

  describe('putStream()', () => {
    afterEach(mm.restore);

    it('should add object with streaming way', async () => {
      const name = `${prefix}ali-sdk/oss/putStream-localfile.js`;
      const object = await this.store.putStream(name, fs.createReadStream(__filename));
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      assert.equal(typeof object.res.rt, 'number');
      assert.equal(object.res.size, 0);
      assert(object.name, name);
      assert(object.url);

      // check content
      const r = await this.store.get(name);
      assert.equal(r.res.status, 200);
      assert.equal(r.content.toString(), fs.readFileSync(__filename, 'utf8'));
    });

    it('should use chunked encoding', async () => {
      const name = `${prefix}ali-sdk/oss/chunked-encoding.js`;
      let header;
      const req = this.store.urllib.request;
      mm(this.store.urllib, 'request', (url, args) => {
        header = args.headers;
        return req(url, args);
      });

      const result = await this.store.putStream(name, fs.createReadStream(__filename));

      assert.equal(result.res.status, 200);
      assert.equal(header['Transfer-Encoding'], 'chunked');
    });

    it('should NOT use chunked encoding', async () => {
      const name = `${prefix}ali-sdk/oss/no-chunked-encoding.js`;
      let header;
      const req = this.store.urllib.request;
      mm(this.store.urllib, 'request', (url, args) => {
        header = args.headers;
        return req(url, args);
      });

      const options = {
        contentLength: fs.statSync(__filename).size,
      };
      const result = await this.store.putStream(name, fs.createReadStream(__filename), options);

      assert(!header['Transfer-Encoding']);
      assert.equal(result.res.status, 200);
    });

    it('should add image with streaming way', async () => {
      const name = `${prefix}ali-sdk/oss/nodejs-1024x768.png`;
      const imagepath = path.join(__dirname, 'nodejs-1024x768.png');
      const object = await this.store.putStream(name, fs.createReadStream(imagepath), {
        mime: 'image/png',
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      assert.equal(typeof object.res.rt, 'number');
      assert.equal(object.res.size, 0);
      assert(object.name, name);

      // check content
      const r = await this.store.get(name);
      assert.equal(r.res.status, 200);
      assert.equal(r.res.headers['content-type'], 'image/png');
      const buf = fs.readFileSync(imagepath);
      assert.equal(r.content.length, buf.length);
      assert.deepEqual(r.content, buf);
    });

    it('should add very big file: 4mb with streaming way', async () => {
      const name = `${prefix}ali-sdk/oss/bigfile-4mb.bin`;
      const bigfile = path.join(__dirname, '.tmp', 'bigfile-4mb.bin');
      fs.writeFileSync(bigfile, Buffer.alloc(4 * 1024 * 1024).fill('a\n'));
      const object = await this.store.putStream(name, fs.createReadStream(bigfile));
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      assert.equal(typeof object.res.rt, 'number');
      assert.equal(object.res.size, 0);
      assert(object.name, name);

      // check content
      const r = await this.store.get(name);
      assert.equal(r.res.status, 200);
      assert.equal(r.res.headers['content-type'], 'application/octet-stream');
      assert.equal(r.res.size, 4 * 1024 * 1024);
      const buf = fs.readFileSync(bigfile);
      assert.equal(r.content.length, buf.length);
      assert.deepEqual(r.content, buf);
    });
  });

  describe('getObjectUrl()', () => {
    it('should return object url', () => {
      let name = 'test.js';
      let url = this.store.getObjectUrl(name);
      assert.equal(url, this.store.options.endpoint.format() + name);

      name = '/foo/bar/a%2Faa/test&+-123~!.js';
      url = this.store.getObjectUrl(name, 'https://foo.com');
      assert.equal(url, 'https://foo.com/foo/bar/a%252Faa/test%26%2B-123~!.js');
      const url2 = this.store.getObjectUrl(name, 'https://foo.com/');
      assert.equal(url2, 'https://foo.com/foo/bar/a%252Faa/test%26%2B-123~!.js');
    });
  });

  describe('generateObjectUrl()', () => {
    it('should return object url', function () {
      let name = 'test.js';
      let url = this.store.generateObjectUrl(name);

      let baseUrl = this.store.options.endpoint.format();
      const copyUrl = urlutil.parse(baseUrl);
      copyUrl.hostname = `${this.bucket}.${copyUrl.hostname}`;
      copyUrl.host = `${this.bucket}.${copyUrl.host}`;
      baseUrl = copyUrl.format();
      assert.equal(url, `${baseUrl}${name}`);

      name = '/foo/bar/a%2Faa/test&+-123~!.js';
      url = this.store.generateObjectUrl(name, 'https://foo.com');
      assert.equal(url, 'https://foo.com/foo/bar/a%252Faa/test%26%2B-123~!.js');
      const url2 = this.store.generateObjectUrl(name, 'https://foo.com/');
      assert.equal(url2, 'https://foo.com/foo/bar/a%252Faa/test%26%2B-123~!.js');
    });
  });


  describe('put()', () => {
    it('should add object with local file path', async () => {
      const name = `${prefix}ali-sdk/oss/put-localfile.js`;
      const object = await this.store.put(name, __filename);
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      assert.equal(typeof object.res.rt, 'number');
      assert.equal(object.res.size, 0);
      assert(object.name, name);
    });

    it('should add object with content buffer', async () => {
      const name = `${prefix}ali-sdk/oss/put-buffer`;
      const object = await this.store.put(`/${name}`, new Buffer('foo content'));
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      assert.equal(typeof object.res.rt, 'number');
      assert(object.name, name);
    });

    it('should add object with readstream', async () => {
      const name = `${prefix}ali-sdk/oss/put-readstream`;
      const stat = await this.store._statFile(__filename);
      const object = await this.store.put(name, fs.createReadStream(__filename), {
        headers: {
          'Content-Length': stat.size,
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      assert.equal(typeof object.res.rt, 'number');
      assert.equal(typeof object.res.headers.etag, 'string');
      assert(object.name, name);
    });

    it('should add object with meta', async () => {
      const name = `${prefix}ali-sdk/oss/put-meta.js`;
      const object = await this.store.put(name, __filename, {
        meta: {
          uid: 1,
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      assert.equal(typeof object.res.rt, 'number');
      assert.equal(object.res.size, 0);
      assert(object.name, name);

      const info = await this.store.head(name);
      assert.deepEqual(info.meta, {
        uid: '1',
        slus: 'test.html',
      });
      assert.equal(info.status, 200);
    });

    it('should set Content-Disposition with ascii name', async () => {
      const name = `${prefix}ali-sdk/oss/put-Content-Disposition.js`;
      const object = await this.store.put(name, __filename, {
        headers: {
          'Content-Disposition': 'ascii-name.js',
        },
      });
      assert(object.name, name);
      const info = await this.store.head(name);
      assert.equal(info.res.headers['content-disposition'], 'ascii-name.js');
    });

    it('should set Content-Disposition with no-ascii name', async () => {
      const name = `${prefix}ali-sdk/oss/put-Content-Disposition.js`;
      const object = await this.store.put(name, __filename, {
        headers: {
          'Content-Disposition': encodeURIComponent('non-ascii-名字.js'),
        },
      });
      assert(object.name, name);
      const info = await this.store.head(name);
      assert.equal(info.res.headers['content-disposition'], 'non-ascii-%E5%90%8D%E5%AD%97.js');
    });

    it('should set Expires', async () => {
      const name = `${prefix}ali-sdk/oss/put-Expires.js`;
      const object = await this.store.put(name, __filename, {
        headers: {
          Expires: 1000000,
        },
      });
      assert(object.name, name);
      const info = await this.store.head(name);
      assert.equal(info.res.headers.expires, '1000000');
    });

    it('should set custom Content-Type', async () => {
      const name = `${prefix}ali-sdk/oss/put-Content-Type.js`;
      const object = await this.store.put(name, __filename, {
        headers: {
          'Content-Type': 'text/plain; charset=gbk',
        },
      });
      assert(object.name, name);
      const info = await this.store.head(name);
      assert.equal(info.res.headers['content-type'], 'text/plain; charset=gbk');
    });

    it('should set custom content-type lower case', async () => {
      const name = `${prefix}ali-sdk/oss/put-Content-Type.js`;
      const object = await this.store.put(name, __filename, {
        headers: {
          'content-type': 'application/javascript; charset=utf8',
        },
      });
      assert(object.name, name);
      const info = await this.store.head(name);
      assert.equal(info.res.headers['content-type'], 'application/javascript; charset=utf8');
    });

    it('should return correct encode when name include + and space', function* () {
      const name = 'ali-sdkhahhhh+oss+mm xxx.js';
      const object = yield this.store.put(name, __filename, {
        headers: {
          'Content-Type': 'text/plain; charset=gbk',
        },
      });
      assert(object.name, name);
      const info = yield this.store.head(name);
      const url = info.res.requestUrls[0];
      const { pathname } = urlutil.parse(url)
      assert.equal(pathname, '/ali-sdkhahhhh%2Boss%2Bmm%20xxx.js');
      assert.equal(info.res.headers['content-type'], 'text/plain; charset=gbk');
    });
  });

  describe('mimetype', () => {
    const createFile = async (name, size) => {
      size = size || 200 * 1024;
      await new Promise(((resolve, reject) => {
        const rs = fs.createReadStream('/dev/random', {
          start: 0,
          end: size - 1,
        });
        const ws = fs.createWriteStream(name);
        rs.pipe(ws);
        ws.on('finish', (err, res) => {
          if (err) {
            reject(err);
          } else {
            resolve(res);
          }
        });
      }));

      return name;
    };

    it('should set mimetype by file ext', async () => {
      const filepath = path.join(tmpdir, 'content-type-by-file.jpg');
      await createFile(filepath);
      const name = `${prefix}ali-sdk/oss/content-type-by-file.png`;
      await this.store.put(name, filepath);

      let result = await this.store.head(name);
      assert.equal(result.res.headers['content-type'], 'image/jpeg');

      await this.store.multipartUpload(name, filepath);
      result = await this.store.head(name);
      assert.equal(result.res.headers['content-type'], 'image/jpeg');
    });

    it('should set mimetype by object key', async () => {
      const filepath = path.join(tmpdir, 'content-type-by-file');
      await createFile(filepath);
      const name = `${prefix}ali-sdk/oss/content-type-by-file.png`;
      await this.store.put(name, filepath);

      let result = await this.store.head(name);
      assert.equal(result.res.headers['content-type'], 'image/png');
      await this.store.multipartUpload(name, filepath);
      result = await this.store.head(name);
      assert.equal(result.res.headers['content-type'], 'image/png');
    });

    it('should set user-specified mimetype', async () => {
      const filepath = path.join(tmpdir, 'content-type-by-file.jpg');
      await createFile(filepath);
      const name = `${prefix}ali-sdk/oss/content-type-by-file.png`;
      await this.store.put(name, filepath, { mime: 'text/plain' });

      let result = await this.store.head(name);
      assert.equal(result.res.headers['content-type'], 'text/plain');
      await this.store.multipartUpload(name, filepath, {
        mime: 'text/plain',
      });
      result = await this.store.head(name);
      assert.equal(result.res.headers['content-type'], 'text/plain');
    });
  });

  describe('head()', () => {
    before(async () => {
      this.name = `${prefix}ali-sdk/oss/head-meta.js`;
      const object = await this.store.put(this.name, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      this.headers = object.res.headers;
    });

    it('should head not exists object throw NoSuchKeyError', async () => {
      await utils.throws(async () => {
        await this.store.head(`${this.name}not-exists`);
      }, (err) => {
        assert.equal(err.name, 'NoSuchKeyError');
        assert.equal(err.status, 404);
        assert.equal(typeof err.requestId, 'string');
      });
    });

    it('should head exists object with If-Modified-Since < object modified time', async () => {
      let lastYear = new Date(this.headers.date);
      lastYear.setFullYear(lastYear.getFullYear() - 1);
      lastYear = lastYear.toGMTString();
      const info = await this.store.head(this.name, {
        headers: {
          'If-Modified-Since': lastYear,
        },
      });
      assert.equal(info.status, 200);
      assert(info.meta);
    });

    it('should head exists object with If-Modified-Since = object modified time', async () => {
      const info = await this.store.head(this.name, {
        headers: {
          'If-Modified-Since': this.headers.date,
        },
      });
      assert.equal(info.status, 304);
      assert.equal(info.meta, null);
    });

    it('should head exists object with If-Modified-Since > object modified time', async () => {
      let nextYear = new Date(this.headers.date);
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      nextYear = nextYear.toGMTString();

      const info = await this.store.head(this.name, {
        headers: {
          'If-Modified-Since': nextYear,
        },
      });
      assert.equal(info.status, 304);
      assert.equal(info.meta, null);
    });

    it('should head exists object with If-Unmodified-Since < object modified time', async () => {
      let lastYear = new Date(this.headers.date);
      lastYear.setFullYear(lastYear.getFullYear() - 1);
      lastYear = lastYear.toGMTString();
      await utils.throws(async () => {
        await this.store.head(this.name, {
          headers: {
            'If-Unmodified-Since': lastYear,
          },
        });
      }, (err) => {
        assert.equal(err.name, 'PreconditionFailedError');
        assert.equal(err.status, 412);
      });
    });

    it('should head exists object with If-Unmodified-Since = object modified time', async () => {
      const info = await this.store.head(this.name, {
        headers: {
          'If-Unmodified-Since': this.headers.date,
        },
      });
      assert.equal(info.status, 200);
      assert(info.meta);
    });

    it('should head exists object with If-Unmodified-Since > object modified time', async () => {
      let nextYear = new Date(this.headers.date);
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      nextYear = nextYear.toGMTString();

      const info = await this.store.head(this.name, {
        headers: {
          'If-Unmodified-Since': nextYear,
        },
      });
      assert.equal(info.status, 200);
      assert(info.meta);
    });

    it('should head exists object with If-Match equal etag', async () => {
      const info = await this.store.head(this.name, {
        headers: {
          'If-Match': this.headers.etag,
        },
      });
      assert.equal(info.meta.uid, '1');
      assert.equal(info.meta.pid, '123');
      assert.equal(info.meta.slus, 'test.html');
      assert.equal(info.status, 200);
    });

    it('should head exists object with If-Match not equal etag', async () => {
      await utils.throws(async () => {
        await this.store.head(this.name, {
          headers: {
            'If-Match': '"foo-etag"',
          },
        });
      }, (err) => {
        assert.equal(err.name, 'PreconditionFailedError');
        assert.equal(err.status, 412);
      });
    });

    it('should head exists object with If-None-Match equal etag', async () => {
      const info = await this.store.head(this.name, {
        headers: {
          'If-None-Match': this.headers.etag,
        },
      });
      assert.equal(info.meta, null);
      assert.equal(info.status, 304);
    });

    it('should head exists object with If-None-Match not equal etag', async () => {
      const info = await this.store.head(this.name, {
        headers: {
          'If-None-Match': '"foo-etag"',
        },
      });
      assert.equal(info.meta.uid, '1');
      assert.equal(info.meta.pid, '123');
      assert.equal(info.meta.slus, 'test.html');
      assert.equal(info.status, 200);
    });
  });

  describe('get()', () => {
    before(async () => {
      this.name = `${prefix}ali-sdk/oss/get-meta.js`;
      let object = await this.store.put(this.name, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      this.headers = object.res.headers;

      this.needEscapeName = `${prefix}ali-sdk/oss/%3get+meta.js`;
      object = await this.store.put(this.needEscapeName, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
    });

    it('should store object to local file', async () => {
      const savepath = path.join(tmpdir, this.name.replace(/\//g, '-'));
      const result = await this.store.get(this.name, savepath);
      assert.equal(result.res.status, 200);
      assert.equal(fs.statSync(savepath).size, fs.statSync(__filename).size);
    });

    it('should escape uri path ok', async () => {
      const savepath = path.join(tmpdir, this.needEscapeName.replace(/\//g, '-'));
      const result = await this.store.get(this.needEscapeName, savepath);
      assert.equal(result.res.status, 200);
      assert.equal(fs.statSync(savepath).size, fs.statSync(__filename).size);
    });

    it('should throw error when save path parent dir not exists', async () => {
      const savepath = path.join(tmpdir, 'not-exists', this.name.replace(/\//g, '-'));
      await utils.throws(async () => {
        await this.store.get(this.name, savepath);
      }, /ENOENT/);
    });

    it('should store object to writeStream', async () => {
      const savepath = path.join(tmpdir, this.name.replace(/\//g, '-'));
      const result = await this.store.get(this.name, fs.createWriteStream(savepath));
      assert.equal(result.res.status, 200);
      assert.equal(fs.statSync(savepath).size, fs.statSync(__filename).size);
    });

    it('should store not exists object to file', async () => {
      const savepath = path.join(tmpdir, this.name.replace(/\//g, '-'));
      await utils.throws(async () => {
        await this.store.get(`${this.name}not-exists`, savepath);
      }, (err) => {
        assert.equal(err.name, 'NoSuchKeyError');
        assert.equal(err.status, 404);
        assert(!fs.existsSync(savepath));
      });
    });

    it('should throw error when writeStream emit error', async () => {
      const savepath = path.join(tmpdir, 'not-exists-dir', this.name.replace(/\//g, '-'));
      await utils.throws(async () => {
        await this.store.get(this.name, fs.createWriteStream(savepath));
      }, /ENOENT/);
    });

    it('should get object content buffer', async () => {
      let result = await this.store.get(this.name);
      assert(Buffer.isBuffer(result.content), 'content should be Buffer');
      assert(result.content.toString().indexOf('ali-sdk/oss/get-meta.js') > 0);

      result = await this.store.get(this.name, null);
      assert(Buffer.isBuffer(result.content), 'content should be Buffer');
      assert(result.content.toString().indexOf('ali-sdk/oss/get-meta.js') > 0);
    });

    it('should get object content buffer with image process', async () => {
      const name = `${prefix}ali-sdk/oss/nodejs-test-get-image-1024x768.png`;
      const originImagePath = path.join(__dirname, 'nodejs-1024x768.png');
      path.join(__dirname, 'nodejs-processed-w200.png');
      await this.store.put(name, originImagePath, {
        mime: 'image/png',
      });

      let result = await this.store.get(name, { process: 'image/resize,w_200' });
      assert.equal(result.res.status, 200);
      assert(Buffer.isBuffer(result.content), 'content should be Buffer');
      // assert.deepEqual(result.content == fs.readFileSync(processedImagePath),
      //   'get content should be same as test/nodejs-processed-w200.png');

      // it should use the value of process
      // when 'subres.x-oss-process' coexists with 'process'.
      result = await this.store.get(
        name,
        { process: 'image/resize,w_200', subres: { 'x-oss-process': 'image/resize,w_100' } },
      );
      assert.equal(result.res.status, 200);
      assert(Buffer.isBuffer(result.content), 'content should be Buffer');
    });

    it('should throw NoSuchKeyError when object not exists', async () => {
      const { store } = this;
      await utils.throws(async () => {
        await store.get('not-exists-key');
      }, (err) => {
        assert.equal(err.name, 'NoSuchKeyError');
        assert.equal(err.status, 404);
        assert.equal(typeof err.requestId, 'string');
        assert.equal(err.message, 'The specified key does not exist.');
      });
    });

    describe('If-Modified-Since header', () => {
      it('should 200 when If-Modified-Since < object modified time', async () => {
        let lastYear = new Date(this.headers.date);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        lastYear = lastYear.toGMTString();
        const result = await this.store.get(this.name, {
          headers: {
            'If-Modified-Since': lastYear,
          },
        });
        assert(Buffer.isBuffer(result.content), 'content should be Buffer');
        assert(result.content.toString().indexOf('ali-sdk/oss/get-meta.js') > 0);
        assert.equal(result.res.status, 200);
      });

      it('should 304 when If-Modified-Since = object modified time', async () => {
        const result = await this.store.get(this.name, {
          headers: {
            'If-Modified-Since': this.headers.date,
          },
        });
        assert(Buffer.isBuffer(result.content), 'content should be Buffer');
        assert.equal(result.content.length, 0);
        assert.equal(result.res.status, 304);
      });

      it('should 304 when If-Modified-Since > object modified time', async () => {
        let nextYear = new Date(this.headers.date);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        nextYear = nextYear.toGMTString();
        const result = await this.store.get(this.name, {
          headers: {
            'If-Modified-Since': nextYear,
          },
        });
        assert(Buffer.isBuffer(result.content), 'content should be Buffer');
        assert.equal(result.content.length, 0);
        assert.equal(result.res.status, 304);
      });
    });

    describe('If-Unmodified-Since header', () => {
      it('should throw PreconditionFailedError when If-Unmodified-Since < object modified time', async () => {
        let lastYear = new Date(this.headers.date);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        lastYear = lastYear.toGMTString();
        await utils.throws(async () => {
          await this.store.get(this.name, {
            headers: {
              'If-Unmodified-Since': lastYear,
            },
          });
        }, (err) => {
          assert.equal(err.status, 412);
          assert.equal(err.name, 'PreconditionFailedError');
          assert.equal(err.message, 'At least one of the pre-conditions you specified did not hold. (condition: If-Unmodified-Since)');
          assert.equal(typeof err.requestId, 'string');
          assert.equal(typeof err.hostId, 'string');
        });
      });

      it('should 200 when If-Unmodified-Since = object modified time', async () => {
        const result = await this.store.get(this.name, {
          headers: {
            'If-Unmodified-Since': this.headers.date,
          },
        });
        assert.equal(result.res.status, 200);
        assert(Buffer.isBuffer(result.content), 'content should be Buffer');
        assert(result.content.toString().indexOf('ali-sdk/oss/get-meta.js') > 0);
      });

      it('should 200 when If-Unmodified-Since > object modified time', async () => {
        let nextYear = new Date(this.headers.date);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        nextYear = nextYear.toGMTString();
        const result = await this.store.get(this.name, {
          headers: {
            'If-Unmodified-Since': nextYear,
          },
        });
        assert.equal(result.res.status, 200);
        assert(Buffer.isBuffer(result.content), 'content should be Buffer');
        assert(result.content.toString().indexOf('ali-sdk/oss/get-meta.js') > 0);
      });
    });

    describe('If-Match header', () => {
      it('should 200 when If-Match equal object etag', async () => {
        const result = await this.store.get(this.name, {
          headers: {
            'If-Match': this.headers.etag,
          },
        });
        assert.equal(result.res.status, 200);
      });

      it('should throw PreconditionFailedError when If-Match not equal object etag', async () => {
        await utils.throws(async () => {
          await this.store.get(this.name, {
            headers: {
              'If-Match': 'foo',
            },
          });
        }, (err) => {
          assert.equal(err.name, 'PreconditionFailedError');
          assert.equal(err.status, 412);
        });
      });
    });

    describe('If-None-Match header', () => {
      it('should 200 when If-None-Match not equal object etag', async () => {
        const result = await this.store.get(this.name, {
          headers: {
            'If-None-Match': 'foo',
          },
        });
        assert.equal(result.res.status, 200);
      });

      it('should 304 when If-None-Match equal object etag', async () => {
        const result = await this.store.get(this.name, {
          headers: {
            'If-None-Match': this.headers.etag,
          },
        });
        assert.equal(result.res.status, 304);
        assert.equal(result.content.length, 0);
      });
    });

    describe('Range header', () => {
      it('should work with Range header and get top 10 bytes content', async () => {
        const content = new Buffer('aaaaaaaaaabbbbbbbbbb');
        await this.store.put('range-header-test', content);
        const result = await this.store.get(this.name, {
          headers: {
            Range: 'bytes=0-9',
          },
        });
        assert.equal(result.res.headers['content-length'], '10');
        assert(Buffer.isBuffer(result.content), 'content should be Buffer');
        assert.equal(result.content.toString(), 'aaaaaaaaaa');
      });
    });
  });

  describe('signatureUrl()', () => {
    before(async () => {
      this.name = `${prefix}ali-sdk/oss/signatureUrl.js`;
      let object = await this.store.put(this.name, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      this.headers = object.res.headers;

      this.needEscapeName = `${prefix}ali-sdk/oss/%3get+meta-signatureUrl.js`;
      object = await this.store.put(this.needEscapeName, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
    });

    it('should signature url get object ok', async () => {
      const result = await this.store.get(this.name);
      const url = this.store.signatureUrl(this.name);
      const urlRes = await urllib.request(url);
      assert.equal(urlRes.data.toString(), result.content.toString());
    });

    it('should signature url with reponse limitation', function* () {
      const response = {
        'content-type': 'xml',
        'content-language': 'zh-cn',
      };
      const url = this.store.signatureUrl(this.name, { response });
      assert(url.indexOf('response-content-type=xml') !== -1);
      assert(url.indexOf('response-content-language=zh-cn') !== -1);
    });

    it('should signature url with image processed and get object ok', async () => {
      const name = `${prefix}ali-sdk/oss/nodejs-test-signature-1024x768.png`;
      const originImagePath = path.join(__dirname, 'nodejs-1024x768.png');
      path.join(__dirname, 'nodejs-processed-w200.png');
      await this.store.put(name, originImagePath, {
        mime: 'image/png',
      });

      const signUrl = this.store.signatureUrl(name, { expires: 3600, process: 'image/resize,w_200' });
      const processedKeyword = 'x-oss-process=image%2Fresize%2Cw_200';
      assert.equal(signUrl.match(processedKeyword), processedKeyword);
      const urlRes = await urllib.request(signUrl);
      assert.equal(urlRes.status, 200);
      // assert(urlRes.data.toString() == fs.readFileSync(processedImagePath, 'utf8'),
      //   'response content should be same as test/nodejs-processed-w200.png');
    });

    it('should signature url for PUT', async () => {
      const putString = 'Hello World';
      const contentMd5 = crypto.createHash('md5').update(new Buffer(putString, 'utf8')).digest('base64');
      const url = this.store.signatureUrl(this.name, {
        method: 'PUT',
        'Content-Type': 'text/plain; charset=UTF-8',
        'Content-Md5': contentMd5,
      });
      const headers = {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Content-MD5': contentMd5,
      };
      const res = await urllib.request(url, { method: 'PUT', data: putString, headers });
      assert.equal(res.status, 200);
      const headRes = await this.store.head(this.name);
      assert.equal(headRes.status, 200);
    });

    it('should signature url for PUT with callback parameter', async () => {
      const callback = {
        url: 'http://oss-demo.aliyuncs.com:23450',
        body: `bucket=${this.bucket}`,
        host: 'oss-demo.aliyuncs.com',
        contentType: 'application/json',
        customValue: {
          key1: 'value1',
          key2: 'value2',
        },
      };

      const options = {
        method: 'PUT',
        expires: 3600,
        callback,
      };

      const url = this.store.signatureUrl(this.name, options);
      const res = await urllib.request(url, options);
      assert.equal(res.status, 200);
    });

    it('should signature url get need escape object ok', async () => {
      const result = await this.store.get(this.needEscapeName);
      const url = this.store.signatureUrl(this.needEscapeName);
      const urlRes = await urllib.request(url);
      assert.equal(urlRes.data.toString(), result.content.toString());
    });

    it('should signature url with custom host ok', () => {
      const conf = {};
      copy(config).to(conf);
      conf.endpoint = 'www.aliyun.com';
      conf.cname = true;
      const store = oss(conf);

      const url = store.signatureUrl(this.name);
      // http://www.aliyun.com/darwin-v4.4.2/ali-sdk/oss/get-meta.js?OSSAccessKeyId=
      assert.equal(url.indexOf('http://www.aliyun.com/'), 0);
    });
  });

  describe('getStream()', () => {
    before(async () => {
      this.name = `${prefix}ali-sdk/oss/get-stream.js`;
      const object = await this.store.put(this.name, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      this.headers = object.res.headers;
    });

    it('should get exists object stream', async () => {
      const result = await this.store.getStream(this.name);
      assert.equal(result.res.status, 200);
      assert(result.stream instanceof Readable);
      const tmpfile = path.join(tmpdir, 'get-stream.js');
      const tmpstream = fs.createWriteStream(tmpfile);

      function finish() {
        return new Promise((resolve) => {
          tmpstream.on('finish', () => {
            resolve();
          });
        });
      }

      result.stream.pipe(tmpstream);
      await finish();
      assert.equal(fs.readFileSync(tmpfile, 'utf8'), fs.readFileSync(__filename, 'utf8'));
    });

    it('should get image stream with image process', async () => {
      const name = `${prefix}ali-sdk/oss/nodejs-test-getstream-image-1024x768.png`;
      const originImagePath = path.join(__dirname, 'nodejs-1024x768.png');
      const processedImagePath = path.join(__dirname, 'nodejs-processed-w200.png');
      await this.store.put(name, originImagePath, {
        mime: 'image/png',
      });

      let result = await this.store.getStream(name, { process: 'image/resize,w_200' });
      assert.equal(result.res.status, 200);
      let isEqual = await streamEqual(result.stream, fs.createReadStream(processedImagePath));
      assert(isEqual);
      result = await this.store.getStream(
        name,
        { process: 'image/resize,w_200', subres: { 'x-oss-process': 'image/resize,w_100' } },
      );
      assert.equal(result.res.status, 200);
      isEqual = await streamEqual(result.stream, fs.createReadStream(processedImagePath));
      assert(isEqual);
    });

    it('should throw error when object not exists', async () => {
      try {
        await this.store.getStream(`${this.name}not-exists`);
        throw new Error('should not run this');
      } catch (err) {
        assert.equal(err.name, 'NoSuchKeyError');
      }
    });
  });

  describe('delete()', () => {
    it('should delete exsits object', async () => {
      const name = `${prefix}ali-sdk/oss/delete.js`;
      await this.store.put(name, __filename);

      const info = await this.store.delete(name);
      assert.equal(info.res.status, 204);

      await utils.throws(async () => {
        await this.store.head(name);
      }, 'NoSuchKeyError');
    });

    it('should delete not exists object', async () => {
      const info = await this.store.delete('not-exists-name');
      assert.equal(info.res.status, 204);
    });
  });

  describe('deleteMulti()', () => {
    beforeEach(async () => {
      this.names = [];
      let name = `${prefix}ali-sdk/oss/deleteMulti0.js`;
      this.names.push(name);
      await this.store.put(name, __filename);

      name = `${prefix}ali-sdk/oss/deleteMulti1.js`;
      this.names.push(name);
      await this.store.put(name, __filename);

      name = `${prefix}ali-sdk/oss/deleteMulti2.js`;
      this.names.push(name);
      await this.store.put(name, __filename);
    });

    it('should delete 3 exists objs', async () => {
      const result = await this.store.deleteMulti(this.names);
      assert.deepEqual(result.deleted, this.names);
      assert.equal(result.res.status, 200);
    });

    it('should delete 2 exists and 2 not exists objs', async () => {
      const result = await this.store.deleteMulti(this.names.slice(0, 2).concat(['not-exist1', 'not-exist2']));
      assert.deepEqual(result.deleted, this.names.slice(0, 2).concat(['not-exist1', 'not-exist2']));
      assert.equal(result.res.status, 200);
    });

    it('should delete 1 exists objs', async () => {
      const result = await this.store.deleteMulti(this.names.slice(0, 1));
      assert.deepEqual(result.deleted, this.names.slice(0, 1));
      assert.equal(result.res.status, 200);
    });

    it('should delete in quiet mode', async () => {
      const result = await this.store.deleteMulti(this.names, {
        quiet: true,
      });
      assert.equal(result.deleted, null);
      assert.equal(result.res.status, 200);
    });
  });

  describe('copy()', () => {
    before(async () => {
      this.name = `${prefix}ali-sdk/oss/copy-meta.js`;
      const object = await this.store.put(this.name, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      this.headers = object.res.headers;
    });

    it('should copy object from same bucket', async () => {
      const name = `${prefix}ali-sdk/oss/copy-new.js`;
      const result = await this.store.copy(name, this.name);
      assert.equal(result.res.status, 200);
      assert.equal(typeof result.data.etag, 'string');
      assert.equal(typeof result.data.lastModified, 'string');

      const info = await this.store.head(name);
      assert.equal(info.meta.uid, '1');
      assert.equal(info.meta.pid, '123');
      assert.equal(info.meta.slus, 'test.html');
      assert.equal(info.status, 200);
    });

    it('should copy object with non-english name', async () => {
      const sourceName = `${prefix}ali-sdk/oss/copy-meta_测试.js`;
      let result = await this.store.put(sourceName, __filename, {
        meta: {
          uid: 2,
          pid: '1234',
          slus: 'test1.html',
        },
      });

      const name = `${prefix}ali-sdk/oss/copy-new_测试.js`;
      result = await this.store.copy(name, sourceName);
      assert.equal(result.res.status, 200);
      assert.equal(typeof result.data.etag, 'string');
      assert.equal(typeof result.data.lastModified, 'string');

      const info = await this.store.head(name);
      assert.equal(info.meta.uid, '2');
      assert.equal(info.meta.pid, '1234');
      assert.equal(info.meta.slus, 'test1.html');
      assert.equal(info.status, 200);
    });

    it('should copy object with non-english name and bucket', async () => {
      let sourceName = `${prefix}ali-sdk/oss/copy-meta_测试2.js`;
      let result = await this.store.put(sourceName, __filename, {
        meta: {
          uid: 3,
          pid: '12345',
          slus: 'test2.html',
        },
      });

      let info = await this.store.head(sourceName);
      assert.equal(info.meta.uid, '3');
      assert.equal(info.meta.pid, '12345');
      assert.equal(info.meta.slus, 'test2.html');
      assert.equal(info.status, 200);

      sourceName = `/${this.bucket}/${sourceName}`;
      const name = `${prefix}ali-sdk/oss/copy-new_测试2.js`;
      result = await this.store.copy(name, sourceName);
      assert.equal(result.res.status, 200);
      assert.equal(typeof result.data.etag, 'string');
      assert.equal(typeof result.data.lastModified, 'string');

      info = await this.store.head(name);
      assert.equal(info.meta.uid, '3');
      assert.equal(info.meta.pid, '12345');
      assert.equal(info.meta.slus, 'test2.html');
      assert.equal(info.status, 200);
    });

    it('should copy object and set other meta', async () => {
      const name = `${prefix}ali-sdk/oss/copy-new-2.js`;
      const result = await this.store.copy(name, this.name, {
        meta: {
          uid: '2',
        },
      });
      assert.equal(result.res.status, 200);
      assert.equal(typeof result.data.etag, 'string');
      assert.equal(typeof result.data.lastModified, 'string');

      const info = await this.store.head(name);
      assert.equal(info.meta.uid, '2');
      assert(!info.meta.pid);
      assert(!info.meta.slus);
      assert.equal(info.status, 200);
    });

    it('should use copy to change exists object headers', async () => {
      const name = `${prefix}ali-sdk/oss/copy-new-3.js`;
      let result = await this.store.copy(name, this.name);
      assert.equal(result.res.status, 200);
      assert.equal(typeof result.data.etag, 'string');
      assert.equal(typeof result.data.lastModified, 'string');
      let info = await this.store.head(name);
      assert(!info.res.headers['cache-control']);

      // add Cache-Control header to a exists object
      result = await this.store.copy(name, name, {
        headers: {
          'Cache-Control': 'max-age=0, s-maxage=86400',
        },
      });
      assert.equal(result.res.status, 200);
      assert.equal(typeof result.data.etag, 'string');
      assert.equal(typeof result.data.lastModified, 'string');
      info = await this.store.head(name);
      assert.equal(info.res.headers['cache-control'], 'max-age=0, s-maxage=86400');
    });

    it('should throw NoSuchKeyError when source object not exists', async () => {
      await utils.throws(async () => {
        await this.store.copy('new-object', 'not-exists-object');
      }, (err) => {
        assert.equal(err.name, 'NoSuchKeyError');
        assert.equal(err.message, 'The specified key does not exist.');
        assert.equal(err.status, 404);
      });
    });

    describe('If-Match header', () => {
      it('should throw PreconditionFailedError when If-Match not equal source object etag', async () => {
        await utils.throws(async () => {
          await this.store.copy('new-name', this.name, {
            headers: {
              'If-Match': 'foo-bar',
            },
          });
        }, (err) => {
          assert.equal(err.name, 'PreconditionFailedError');
          assert.equal(err.message, 'At least one of the pre-conditions you specified did not hold. (condition: If-Match)');
          assert.equal(err.status, 412);
        });
      });

      it('should copy object when If-Match equal source object etag', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-Match.js`;
        const result = await this.store.copy(name, this.name, {
          headers: {
            'If-Match': this.headers.etag,
          },
        });
        assert.equal(result.res.status, 200);
        assert.equal(typeof result.data.etag, 'string');
        assert.equal(typeof result.data.lastModified, 'string');
      });
    });

    describe('If-None-Match header', () => {
      it('should return 304 when If-None-Match equal source object etag', async () => {
        const result = await this.store.copy('new-name', this.name, {
          headers: {
            'If-None-Match': this.headers.etag,
          },
        });
        assert.equal(result.res.status, 304);
        assert.equal(result.data, null);
      });

      it('should copy object when If-None-Match not equal source object etag', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-None-Match.js`;
        const result = await this.store.copy(name, this.name, {
          headers: {
            'If-None-Match': 'foo-bar',
          },
        });
        assert.equal(result.res.status, 200);
        assert.equal(typeof result.data.etag, 'string');
        assert.equal(typeof result.data.lastModified, 'string');
      });
    });

    describe('If-Modified-Since header', () => {
      it('should 304 when If-Modified-Since > source object modified time', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-Modified-Since.js`;
        let nextYear = new Date(this.headers.date);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        nextYear = nextYear.toGMTString();
        const result = await this.store.copy(name, this.name, {
          headers: {
            'If-Modified-Since': nextYear,
          },
        });
        assert.equal(result.res.status, 304);
      });

      it('should 304 when If-Modified-Since >= source object modified time', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-Modified-Since.js`;
        const result = await this.store.copy(name, this.name, {
          headers: {
            'If-Modified-Since': this.headers.date,
          },
        });
        assert.equal(result.res.status, 304);
      });

      it('should 200 when If-Modified-Since < source object modified time', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-Modified-Since.js`;
        let lastYear = new Date(this.headers.date);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        lastYear = lastYear.toGMTString();
        const result = await this.store.copy(name, this.name, {
          headers: {
            'If-Modified-Since': lastYear,
          },
        });
        assert.equal(result.res.status, 200);
      });
    });

    describe('If-Unmodified-Since header', () => {
      it('should 200 when If-Unmodified-Since > source object modified time', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-Unmodified-Since.js`;
        let nextYear = new Date(this.headers.date);
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        nextYear = nextYear.toGMTString();
        const result = await this.store.copy(name, this.name, {
          headers: {
            'If-Unmodified-Since': nextYear,
          },
        });
        assert.equal(result.res.status, 200);
      });

      it('should 200 when If-Unmodified-Since >= source object modified time', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-Unmodified-Since.js`;
        const result = await this.store.copy(name, this.name, {
          headers: {
            'If-Unmodified-Since': this.headers.date,
          },
        });
        assert.equal(result.res.status, 200);
      });

      it('should throw PreconditionFailedError when If-Unmodified-Since < source object modified time', async () => {
        const name = `${prefix}ali-sdk/oss/copy-new-If-Unmodified-Since.js`;
        let lastYear = new Date(this.headers.date);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        lastYear = lastYear.toGMTString();
        await utils.throws(async () => {
          await this.store.copy(name, this.name, {
            headers: {
              'If-Unmodified-Since': lastYear,
            },
          });
        }, (err) => {
          assert.equal(err.name, 'PreconditionFailedError');
          assert.equal(err.message, 'At least one of the pre-conditions you specified did not hold. (condition: If-Unmodified-Since)');
          assert.equal(err.status, 412);
        });
      });
    });
  });

  describe('putMeta()', () => {
    before(async () => {
      this.name = `${prefix}ali-sdk/oss/putMeta.js`;
      const object = await this.store.put(this.name, __filename, {
        meta: {
          uid: 1,
          pid: '123',
          slus: 'test.html',
        },
      });
      assert.equal(typeof object.res.headers['x-oss-request-id'], 'string');
      this.headers = object.res.headers;
    });

    it('should update exists object meta', async () => {
      await this.store.putMeta(this.name, {
        uid: '2',
      });
      const info = await this.store.head(this.name);
      assert.equal(info.meta.uid, '2');
      assert(!info.meta.pid);
      assert(!info.meta.slus);
    });

    it('should throw NoSuchKeyError when update not exists object meta', async () => {
      await utils.throws(async () => {
        await this.store.putMeta(`${this.name}not-exists`, {
          uid: '2',
        });
      }, (err) => {
        assert.equal(err.name, 'NoSuchKeyError');
        assert.equal(err.status, 404);
      });
    });
  });

  describe('list()', () => {
    // oss.jpg
    // fun/test.jpg
    // fun/movie/001.avi
    // fun/movie/007.avi
    before(async () => {
      const listPrefix = `${prefix}ali-sdk/list/`;
      await this.store.put(`${listPrefix}oss.jpg`, new Buffer('oss.jpg'));
      await this.store.put(`${listPrefix}fun/test.jpg`, new Buffer('fun/test.jpg'));
      await this.store.put(`${listPrefix}fun/movie/001.avi`, new Buffer('fun/movie/001.avi'));
      await this.store.put(`${listPrefix}fun/movie/007.avi`, new Buffer('fun/movie/007.avi'));
      await this.store.put(`${listPrefix}other/movie/007.avi`, new Buffer('other/movie/007.avi'));
      await this.store.put(`${listPrefix}other/movie/008.avi`, new Buffer('other/movie/008.avi'));
      this.listPrefix = listPrefix;
    });

    function checkObjectProperties(obj) {
      assert.equal(typeof obj.name, 'string');
      assert.equal(typeof obj.lastModified, 'string');
      assert.equal(typeof obj.etag, 'string');
      assert(obj.type === 'Normal' || obj.type === 'Multipart');
      assert.equal(typeof obj.size, 'number');
      assert.equal(obj.storageClass, 'Standard');
      assert.equal(typeof obj.owner, 'object');
      assert.equal(typeof obj.owner.id, 'string');
      assert.equal(typeof obj.owner.displayName, 'string');
    }

    it('should list only 1 object', async () => {
      const result = await this.store.list({
        'max-keys': 1,
      });
      assert.equal(result.objects.length, 1);
      result.objects.map(checkObjectProperties);
      assert.equal(typeof result.nextMarker, 'string');
      assert(result.isTruncated);
      assert.equal(result.prefixes, null);
    });

    it('should list top 3 objects', async () => {
      const result = await this.store.list({
        'max-keys': 3,
      });
      assert.equal(result.objects.length, 3);
      result.objects.map(checkObjectProperties);
      assert.equal(typeof result.nextMarker, 'string');
      assert(result.isTruncated);
      assert.equal(result.prefixes, null);

      // next 2
      const result2 = await this.store.list({
        'max-keys': 2,
        marker: result.nextMarker,
      });
      assert.equal(result2.objects.length, 2);
      result.objects.map(checkObjectProperties);
      assert.equal(typeof result2.nextMarker, 'string');
      assert(result2.isTruncated);
      assert.equal(result2.prefixes, null);
    });

    it('should list with prefix', async () => {
      let result = await this.store.list({
        prefix: `${this.listPrefix}fun/movie/`,
      });
      assert.equal(result.objects.length, 2);
      result.objects.map(checkObjectProperties);
      assert.equal(result.nextMarker, null);
      assert(!result.isTruncated);
      assert.equal(result.prefixes, null);

      result = await this.store.list({
        prefix: `${this.listPrefix}fun/movie`,
      });
      assert.equal(result.objects.length, 2);
      result.objects.map(checkObjectProperties);
      assert.equal(result.nextMarker, null);
      assert(!result.isTruncated);
      assert.equal(result.prefixes, null);
    });

    it('should list current dir files only', async () => {
      let result = await this.store.list({
        prefix: this.listPrefix,
        delimiter: '/',
      });
      assert.equal(result.objects.length, 1);
      result.objects.map(checkObjectProperties);
      assert.equal(result.nextMarker, null);
      assert(!result.isTruncated);
      assert.deepEqual(result.prefixes, [`${this.listPrefix}fun/`, `${this.listPrefix}other/`]);

      result = await this.store.list({
        prefix: `${this.listPrefix}fun/`,
        delimiter: '/',
      });
      assert.equal(result.objects.length, 1);
      result.objects.map(checkObjectProperties);
      assert.equal(result.nextMarker, null);
      assert(!result.isTruncated);
      assert.deepEqual(result.prefixes, [`${this.listPrefix}fun/movie/`]);

      result = await this.store.list({
        prefix: `${this.listPrefix}fun/movie/`,
        delimiter: '/',
      });
      assert.equal(result.objects.length, 2);
      result.objects.map(checkObjectProperties);
      assert.equal(result.nextMarker, null);
      assert(!result.isTruncated);
      assert.equal(result.prefixes, null);
    });
  });

  describe('object key encoding', () => {
    it('should encode variant object keys', async () => {
      const prefixz = 'ali-oss-test-key-';
      const keys = {
        simple: 'simple_key',
        chinese: '杭州・中国',
        space: '是 空格 yeah +-/\\&*#(1) ',
        invisible: '\x01\x0a\x0c\x07\x50\x63',
        xml: 'a<b&c>d +',
      };

      const names = [];
      /* eslint no-restricted-syntax: [0] */
      /* eslint guard-for-in: [0] */
      /* eslint no-await-in-loop: [0] */
      for (const k in keys) {
        const key = prefixz + keys[k];
        let result = await this.store.put(key, new Buffer(''));
        assert.equal(result.res.status, 200);

        result = await this.store.list({
          prefixz,
        });
        const objects = result.objects.map(obj => obj.name);
        assert(objects.indexOf(key) >= 0);

        result = await this.store.head(key);
        assert.equal(result.res.status, 200);

        names.push(keys[k]);
      }

      const result = await this.store.deleteMulti(names);
      assert.equal(result.res.status, 200);
      assert.deepEqual(result.deleted, names);
    });
  });

  describe('putACL(), getACL()', () => {
    it('should put and get object ACL', async () => {
      const name = `${prefix}object/acl`;
      let result = await this.store.put(name, new Buffer('hello world'));
      assert.equal(result.res.status, 200);

      result = await this.store.getACL(name);
      assert.equal(result.res.status, 200);
      assert.equal(result.acl, 'default');

      result = await this.store.putACL(name, 'public-read');
      assert.equal(result.res.status, 200);

      result = await this.store.getACL(name);
      assert.equal(result.res.status, 200);
      assert.equal(result.acl, 'public-read');

      result = await this.store.get(name);
      assert.equal(result.res.status, 200);
      assert.deepEqual(result.content, new Buffer('hello world'));
    });
  });

  describe('append()', () => {
    const name = `/${prefix}ali-sdk/oss/apend${Date.now()}`;
    afterEach(async () => {
      await this.store.delete(name);
    });

    it('should apend object with content buffer', async () => {
      let object = await this.store.append(name, new Buffer('foo'));
      assert(object.res.status === 200);
      assert(object.nextAppendPosition === '3');
      assert(object.res.headers['x-oss-next-append-position'] === '3');

      let res = await urllib.request(this.store.signatureUrl(name));
      assert(res.data.toString() === 'foo');
      assert(res.headers['x-oss-next-append-position'] === '3');

      object = await this.store.append(name, new Buffer('bar'), {
        position: 3,
      });
      assert(object.res.status === 200);
      assert(object.nextAppendPosition === '6');
      assert(object.res.headers['x-oss-next-append-position'] === '6');

      res = await urllib.request(this.store.signatureUrl(name));
      assert(res.data.toString() === 'foobar');
      assert(res.headers['x-oss-next-append-position'] === '6');
    });

    it('should apend object with local file path', async () => {
      const file = path.join(__dirname, 'fixtures/foo.js');
      let object = await this.store.append(name, file);
      assert(object.nextAppendPosition === '16');

      object = await this.store.append(name, file, { position: 16 });
      assert(object.nextAppendPosition === '32');
    });

    it('should apend object with readstream', async () => {
      const file = path.join(__dirname, 'fixtures/foo.js');
      let object = await this.store.append(name, fs.createReadStream(file));
      assert(object.nextAppendPosition === '16');

      object = await this.store.append(name, fs.createReadStream(file), {
        position: 16,
      });
      assert(object.nextAppendPosition === '32');
    });

    it('should error when positio not match', async () => {
      await this.store.append(name, new Buffer('foo'));

      try {
        await this.store.append(name, new Buffer('foo'));
        throw new Error('should not run');
      } catch (err) {
        assert(err.message === 'Position is not equal to file length');
        assert(err.name === 'PositionNotEqualToLengthError');
      }
    });

    it('should use nextAppendPosition to append next', async () => {
      let object = await this.store.append(name, new Buffer('foo'));
      assert(object.nextAppendPosition === '3');

      object = await this.store.append(name, new Buffer('bar'), {
        position: object.nextAppendPosition,
      });

      object = await this.store.append(name, new Buffer('baz'), {
        position: object.nextAppendPosition,
      });

      const res = await urllib.request(this.store.signatureUrl(name));
      assert(res.data.toString() === 'foobarbaz');
      assert(res.headers['x-oss-next-append-position'] === '9');
    });
  });

  describe('restore()', () => {
    it('Should return OperationNotSupportedError when the type of bucket is not archive', function* () {
      const name = '/oss/restore.js';
      yield this.store.put(name, __filename);

      try {
        yield this.store.restore(name);
        throw new Error('should not run this');
      } catch (err) {
        assert.equal(err.name, 'OperationNotSupportedError');
      }
    });
    it('Should return 202 when restore is called first', function* () {
      yield this.store.useBucket(this.archvieBucket, this.region);

      const name = '/oss/restore.js';
      yield this.store.put(name, __filename);

      const info = yield this.store.restore(name);
      assert.equal(info.res.status, 202);

      // in 1 minute veriy RestoreAlreadyInProgressError
      try {
        yield this.store.restore(name);
      } catch (err) {
        assert.equal(err.name, 'RestoreAlreadyInProgressError');
      }
    });
  });
});
