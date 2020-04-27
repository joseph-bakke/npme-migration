const tar = require('tar-stream');
const { v4: uuid }  = require('uuid');
const { ReadableStreamBuffer, WritableStreamBuffer } = require('stream-buffers')
const zlib = require('zlib');
const gunzip = require('gunzip-maybe');
const path = require('path');
const fs = require('fs-extra');

const { NPME_URL } = require('./constants');

// largely copied from https://github.com/npm/pneumatic-tubes/blob/master/lib/transform-tarball.js
async function transformTarball(tempFolder, {tarballPath}) {
    const newTarball = path.resolve(tempFolder, `${uuid()}.tgz`)
    const srcStream = fs.createReadStream(tarballPath)
    const dstStream = fs.createWriteStream(newTarball)
    const gunzipStream = gunzip()
    const gzipStream = zlib.createGzip();

    return new Promise((resolve, reject) => {
        // Check whether the property is defined in the tarball
        const done = async error => {
            if (error) {
                console.error('Error in stream:', error)
                reject(error)
            } else {
                pack.finalize()
                await fs.remove(tarballPath); // remove untransformed tarball
                await fs.move(newTarball, tarballPath); // move transformed tarball to original location
                console.info(`transformed to ${tarballPath}`)
                resolve(newTarball);
            }
        }

        const extract = tar.extract()
        const pack = tar.pack()

        extract.on('entry', (header, stream, callback) => {
            if (header.size === 0) {
                stream.on('end', () => pack.entry(header, callback).end())
                stream.resume()
            } else if (header.name === 'package/package.json') {
                // console.info(`Inspecting ${header.name}`)
                const inBuffer = new WritableStreamBuffer()
                const outBuffer = new ReadableStreamBuffer()

                stream
                    .pipe(inBuffer)
                    .once('error', error => reject(error))
                    .once('finish', () => {
                        const pkgString = inBuffer.getContentsAsString('utf8')
                        const pkg = JSON.parse(pkgString)
                        if ((pkg.publishConfig || {}).registry == null) {
                            outBuffer.put(pkgString)
                        } else {
                            correctedPublishRegistry = true
                            // console.info(`rewriting custom registry: ${pkg.publishConfig.registry} -> ${NPME_URL}`)
                            pkg.publishConfig.registry = NPME_URL;

                            // tags are saved from ZNPM and will be assigned after publish
                            if (pkg.publishConfig.tag) {
                                delete pkg.publishConfig['tag'];
                            }
                            outBuffer.put(JSON.stringify(pkg, null, 2) + '\n', 'utf8')
                        }
                        outBuffer.stop()
                        header.size = outBuffer.size()
                        outBuffer.pipe(pack.entry(header, callback))
                    })
            } else {
                // Forward the entry into the new tarball unmodified.
                // console.info(`Forwarding ${header.name}`);
                stream.pipe(pack.entry(header, callback));
            }
        });

        extract.once('finish', () => done())

        const streams = [srcStream, dstStream, gunzipStream, gzipStream, extract]
        streams.forEach(stream => stream.once('error', error => done(error)))

        srcStream.pipe(gunzipStream).pipe(extract)
        pack.pipe(gzipStream).pipe(dstStream)
    });
}

module.exports = transformTarball;