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
    return new Promise((resolve, reject) => {
        const newTarball = path.resolve(tempFolder, `${uuid()}.tgz`)
        const srcStream = fs.createReadStream(tarballPath)
        const dstStream = fs.createWriteStream(newTarball)
        const gunzipStream = gunzip()
        const gzipStream = zlib.createGzip();

        // Check whether the property is defined in the tarball
        const done = async error => {
            if (error) {
                console.error('Error in stream:', error)
                reject(error)
            } else {
                pack.finalize();
                await fs.remove(tarballPath); // remove untransformed tarball
                await fs.move(newTarball, tarballPath); // move transformed tarball to original location
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
                const inBuffer = new WritableStreamBuffer();
                const outBuffer = new ReadableStreamBuffer();

                stream
                    .pipe(inBuffer)
                    .once('error', error => reject(error))
                    .once('finish', () => {
                        const pkgString = inBuffer.getContentsAsString('utf8')
                        const pkg = JSON.parse(pkgString);
                        const updatedPkg = {...pkg, publishConfig: { registry: NPME_URL }};
                        const updatedHeader = { ...header };
 
                        outBuffer.put(JSON.stringify(updatedPkg, null, 2) + '\n', 'utf8');
                        outBuffer.stop();
                        updatedHeader.size = outBuffer.size();
                        outBuffer.pipe(pack.entry(updatedHeader, callback));
                    });
            } else {
                // Forward the entry into the new tarball unmodified.
                stream.pipe(pack.entry(header, callback));
            }
        });

        pack.on('error', (err) => {console.log('pack error'); console.log(err); reject(err);} )

        extract.once('finish', () => done())
        extract.once('error', (err) => {
            console.log('error extracting');
            console.log(err);
            reject(err);
        });

        const streams = {
            srcStream, 
            dstStream, 
            gunzipStream, 
            gzipStream
        };
        
        Object
            .keys(streams)
            .forEach(streamName => streams[streamName].once('error', error => {
                console.log(streamName); 
                done(error);
            }))

        srcStream
            .pipe(gunzipStream)
            .pipe(extract)
        
        pack
            .pipe(gzipStream)
            .pipe(dstStream)
    });
}

module.exports = transformTarball;