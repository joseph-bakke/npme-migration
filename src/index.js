#!/usr/bin/env node

const fs = require('fs-extra');
const axios = require('axios');
const Promise = require('bluebird');
const tempy = require('tempy');
const path = require('path');
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

    console.log(`Cannot find ${tarballPath} on disk. Downloading ${tarball}`);
    const writeStream = fs.createWriteStream(tarballPath);

    try {
        const { data } = await axios.get(tarball, { responseType: 'stream' });
        data.pipe(writeStream);
    
        return new Promise(resolve => {
            data.on('end', resolve);
        });
    } catch (e) {
        console.log(e);
    }
}

async function assignDistTags({ name, version, distTags }) {
    await Promise.each(distTags, async (distTag) => {
        try {
            console.log(`Adding dist tag ${distTag} to ${name}@${version}`);
            await npmDistTag.add(`${name}@${version}`, distTag, { registry: NPME_URL, token: process.env.NPME_TOKEN })
        } catch (e) {
            console.log(e);
        }
    });
}

async function migratePackages() {
    const [ packagesDir, specificPackage ] = process.argv.slice(2);

    if (!packagesDir) {
        console.log('Cannot migrate without packages dir');
        process.exit(1);
    }

    const start = Date.now();
    await fs.ensureDir(TEMP_FOLDER);
    const packages = await fs.readdir(path.resolve(packagesDir));
    const { doc_count: initialNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);

    const packagesToFetch = specificPackage ? [specificPackage] : packages;
    const failedToPublish = [];
    let publishedVersions = 0;
    
    await Promise.each(packagesToFetch, async (packageName, index, length) => {
        console.log(`Processing package ${index + 1} / ${length}: ${packageName}`);
        const unpublishedVersions = await fetchUnpublishedVersions(packageName);
        console.log(`Got ${unpublishedVersions.length} unpublished versions to migrate`);
        
        await Promise.map(unpublishedVersions, ensureTarballOnDisk);
        await Promise.map(unpublishedVersions, async (manifest, index, length) => {
            console.log(`Transforming tarball: ${index + 1} / ${length}: ${manifest.tarballPath}`);
            try {
                await transformTarball(TEMP_FOLDER, manifest);
            } catch (e) {
                console.log(e);
                failedToPublish.push(manifest);
            }
        });
    
        await Promise.each(unpublishedVersions, async (manifest, index, length) => {
            try {
                await npmPublish(manifest);
                console.log(`Published ${index + 1} / ${length}: ${manifest.name}@${manifest.version}`);
            } catch (e) {
                console.log(`error publishing ${manifest.name}@${manifest.version}`)
                console.log(e);
                failedToPublish.push(manifest);
            }
        });

        await Promise.map(unpublishedVersions, assignDistTags);
        publishedVersions += unpublishedVersions.length;
    });

    const { doc_count: finalNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);
    console.log(`Finished in ${Date.now() - start}ms`);
    console.log(`published versions: ${publishedVersions}`);
    console.log(`npme doc count diff: ${finalNpmeDocCount - initialNpmeDocCount}`);

    console.log(`Failed to publish: ${failedToPublish.map((manifest) => `${manifest.name}@${manifest.version}`).join('\n')}`);
    await fs.writeFile(FAILED_PUBLISH_OUT, JSON.stringify(failedToPublish));
    process.exit(0);

}

migratePackages();

