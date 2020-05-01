const tar = require('tar-stream');
const { v4: uuid }  = require('uuid');
const { ReadableStreamBuffer, WritableStreamBuffer } = require('stream-buffers')
const zlib = require('zlib');
const gunzip = require('gunzip-maybe');
const path = require('path');
const fs = require('fs-extra');

const { NPME_URL } = require('./constants');

// largely copied from https://github.com/npm/pneumatic-tubes/blob/master/lib/transform-tarball.js
function transformTarball(tempFolder, manifest) {
    return new Promise(async (resolve, reject) => {
        const { tarballPath } = manifest;
        const newTarball = path.resolve(tempFolder, `${uuid()}.tgz`);
        const srcStream = fs.createReadStream(tarballPath);
        const dstStream = fs.createWriteStream(newTarball);
        const gunzipStream = gunzip();
        const gzipStream = zlib.createGzip();

        const extract = tar.extract();
        const pack = tar.pack();

        extract.on('entry', (header, stream, callback) => {
            if (header.size === 0) {
                console.log('header size 0');
                stream.on('end', () => pack.entry(header, callback).end())
                stream.resume()
            } else if (header.name === 'package/package.json') {
                const inBuffer = new WritableStreamBuffer();
                const outBuffer = new ReadableStreamBuffer();

                stream
                    .pipe(inBuffer)
                    .once('error', error => reject(error))
                    .once('finish', () => {
                        const pkgString = inBuffer.getContentsAsString('utf8');
                        const pkg = JSON.parse(pkgString);

                        pkg.publishConfig = {
                            registry: NPME_URL
                        };

                        const updatedHeader = { ...header };
                        const stringified = JSON.stringify(pkg, null, 2);
                        
                        outBuffer.put(stringified, 'utf8');
                        outBuffer.stop();
                        updatedHeader.size = outBuffer.size();

                        outBuffer.pipe(pack.entry(updatedHeader, callback));
                    });
            } else {
                // Forward the entry into the new tarball unmodified.
                stream.pipe(pack.entry(header, callback));
            }
        });

        extract.once('finish', () => {
            // once all the entries have been extracted start finalizing the packing
            pack.finalize();
        });

        dstStream.on('finish', async () => {
            console.log(`done writing to ${newTarball}`);
            const validateRead = fs.createReadStream(newTarball);
            const validateExtract = tar.extract();
            const validateGunzip = gunzip();

            validateExtract.on('entry', (header, stream, done) => {
                if (header.name === 'package/package.json') {
                    console.log(`validating ${manifest.name}@${manifest.version} package.json`);
                    const validateBuffer = new WritableStreamBuffer();

                    stream
                        .pipe(validateBuffer)
                        .on('finish', () => {
                            const stringified = validateBuffer.getContentsAsString('utf8');
                            try {
                                JSON.parse(stringified);
                            } catch (e) {
                                console.log(`Package.json was corrupted during trasnforming.`);
                                reject(e);
                            }
                            console.log(`${manifest.name}@${manifest.version} package.json is valid`);
                            done();
                            stream.resume();
                        });
                } else {
                    stream.on('end', () => done());
                    stream.resume();
                }
            });

            validateExtract.once('finish', async () => {
                console.log('done validating');
                await fs.move(newTarball, tarballPath, { overwrite: true });
                resolve();
            });

            validateRead
                .pipe(validateGunzip)
                .pipe(validateExtract);


        });

        const streams = {
            srcStream, 
            dstStream, 
            gunzipStream, 
            gzipStream,
            pack,
            extract
        };
        
        Object
            .keys(streams)
            .forEach(streamName => streams[streamName].once('error', error => {
                console.log(`Error transforming tarball ${tarballPath} at step ${streamName}`);
                reject(error);
            }));

        console.log(`Transforming tarball: ${tarballPath}`);

        srcStream
            .pipe(gunzipStream)
            .pipe(extract);
            
        pack
            .pipe(gzipStream)
            .pipe(dstStream);
    });
}

module.exports = transformTarball;