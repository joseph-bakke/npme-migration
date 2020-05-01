#!/usr/bin/env node

const fs = require('fs-extra');
const axios = require('axios');
const Promise = require('bluebird');
const tempy = require('tempy');
const path = require('path');
const prettyMs = require('pretty-ms');
const npmDistTag = require('@lerna/npm-dist-tag');

const transformTarball = require('./transformTarball');
const fetchUnpublishedVersions = require('./fetchUnpublishedVersions');
const npmPublish = require('./npmPublish');
const { NPME_URL } = require('./constants');

const TEMP_FOLDER = tempy.directory();
const FAILED_PUBLISH_OUT = path.resolve('./', 'failed_publish.txt');

async function getRegistryMetaInfo(registryUrl) {
    try {
        const { data } = await axios.get(registryUrl);
        return data;
    } catch (e) {
        console.log(e);
    }
    return {};
}

async function ensureTarballOnDisk({tarballPath, dist: { tarball }}) {
    if (await fs.exists(tarballPath)) {
        return;
    }

    return new Promise(async (resolve, reject) => {
        console.log(`Cannot find ${tarballPath} on disk. Downloading ${tarball}`);
        const writeStream = fs.createWriteStream(tarballPath);
    
        try {
            const { data } = await axios.get(tarball, { responseType: 'stream' });
            let count = 0;

            writeStream.on('close', () => {
                console.log(`Wrote tarball with size ${count} to ${tarballPath}`);
                resolve(tarballPath);
            });
            
            data.on('data', (chunk) => count += chunk.length);
            data.on('error', reject);
            
            data.pipe(writeStream);
            
        } catch (e) {
            reject(e);
        }
    });
}

async function assignDistTags({ name, version, distTags }) {
    return Promise.each(distTags, async (distTag) => {
        try {
            console.log(`Adding dist tag ${distTag} to ${name}@${version}`);
            await npmDistTag.add(`${name}@${version}`, distTag, { registry: NPME_URL, token: process.env.NPME_TOKEN })
        } catch (e) {
            console.log(e);
        }
    });
}

async function migratePackages() {
    const start = Date.now();
    await fs.ensureDir(TEMP_FOLDER);
    let [ packagesDir, startIndex, sliceLength ] = process.argv.slice(2);

    if (!packagesDir) {
        console.log('Cannot migrate without packages dir');
        process.exit(1);
    }
    
    const packages = await fs.readdir(path.resolve(packagesDir));
    const { doc_count: initialNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);

    startIndex = parseInt(startIndex) || 0;
    sliceLength = parseInt(sliceLength) || packages.length;

    const packagesToFetch = packages.slice(startIndex, sliceLength);

    const failedToPublish = [];
    let publishedVersions = 0;
    let avgPublishTime = 0;
    let avgPackages = 0;
    let nonZeroPackageCount = 0;
    let totalTime = 0;
    
    await Promise.each(packagesToFetch, async (packageName, packagesIndex, packagesLength) => {
        console.log(`Processing package ${packagesIndex + 1} / ${packagesLength}: ${packageName}`);
        const unpublishedVersions = (await fetchUnpublishedVersions(packageName));
        console.log(`Got ${unpublishedVersions.length} unpublished versions to migrate`);

        if (unpublishedVersions.length === 0) {
            return;
        }
        nonZeroPackageCount += 1;
        avgPackages = ((avgPackages * nonZeroPackageCount) + unpublishedVersions.length) / (nonZeroPackageCount + 1);

        await Promise.each(unpublishedVersions, async (manifest, index, length) => {
            console.log(`Migrating ${manifest.name}@${manifest.version}: ${index + 1} / ${length}`);

            try {                
                await ensureTarballOnDisk(manifest);
                
                const { size: originalSize } = await fs.stat(manifest.tarballPath);
                
                await transformTarball(TEMP_FOLDER, manifest);

                const { size: transformedSize } = await fs.stat(manifest.tarballPath);
                console.log(`Original size: ${originalSize}. Transformed size: ${transformedSize}`);
                console.log(`Size diff: ${originalSize - transformedSize}`);

                const publishStart = Date.now();
                await npmPublish(manifest);
                const publishTime = Date.now() - publishStart;
                totalTime += totalTime;
                avgPublishTime = ((avgPublishTime * index) + publishTime) / (index + 1);

                console.log('---------------------------------------');
                console.log(`Took ${prettyMs(publishTime)} to publish`);
                console.log(`Averaging ${prettyMs(avgPublishTime)} per publish`);
                console.log(`Averaging ${avgPackages} versions per package`);
                console.log(`${packagesLength - packagesIndex + 1} packages remaining`);
                console.log(`${(packagesLength - packagesIndex + 1) * avgPackages} versions remaining`);
                console.log(`Estimated ${prettyMs(avgPublishTime * (length - index + 1))} remaining for package`);
                console.log(`Estimated ${prettyMs(avgPublishTime * ((avgPackages * (packagesLength - packagesIndex + 1) + (length - index + 1))))} remaining for all packages`)
                console.log('---------------------------------------');
                await assignDistTags(manifest);
            } catch (e) {
                console.log(`Failed to migrate ${manifest.name}@${manifest.version}`);
                console.log(e);
                failedToPublish.push(manifest);
            }
        });


        publishedVersions += unpublishedVersions.length;
    });

    const onExit = async () => {
        const { doc_count: finalNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);
        const took = Date.now() - start;
        const avg = Math.floor(took / publishedVersions);
        console.log(`Finished in ${took}ms`);
        console.log(`published versions: ${publishedVersions}`);
        console.log(`npme doc count diff: ${finalNpmeDocCount - initialNpmeDocCount}`);
        console.log(`avg time per package: ${prettyMs(avg)}`);
        console.log(`expected total time: ${prettyMs(avg * 500 * 976)}`);
    
        console.log(`Failed to publish: ${failedToPublish.map((manifest) => `${manifest.name}@${manifest.version}`).join('\n')}`);
        await fs.writeFile(FAILED_PUBLISH_OUT, JSON.stringify(failedToPublish));
        process.exit(0);
    }

    process.on('exit', onExit);
    process.on('SIGINT', onExit);
}

migratePackages();

