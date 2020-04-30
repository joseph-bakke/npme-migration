#!/usr/bin/env node

const fs = require('fs-extra');
const axios = require('axios');
const Promise = require('bluebird');
const tempy = require('tempy');
const npm = require('npm');
const path = require('path');
const npmDistTag = require('@lerna/npm-dist-tag');
const npmFetch = require('npm-registry-fetch');

const transformTarball = require('./transformTarball');
const fetchUnpublishedVersions = require('./fetchUnpublishedVersions');
const { NPME_URL } = require('./constants');

const TEMP_FOLDER = tempy.directory();

async function getRegistryMetaInfo(registryUrl) {
    try {
        const { data } = await axios.get(registryUrl);
        return data;
    } catch (e) {
        console.log(e);
    }
    return {};
}

async function ensureTarballOnDisk({tarballPath, tarballUrl}) {
    if (await fs.exists(tarballPath)) {
        return;
    }

    console.log(`Cannot find ${tarballPath} on disk. Downloading ${tarballUrl}`);
    const writeStream = fs.createWriteStream(tarballPath);
    const { data } = await axios.get(tarballUrl, { responseType: 'stream' });

    data.pipe(writeStream);

    return new Promise(resolve => {
        writeStream.on('close', resolve);
    });
}

async function publishToNpm({ packageName, tarballPath }, index, length) {
    try {
        console.log(`publishing ${packageName} from ${tarballPath} to ${NPME_URL}`);
    } catch (e) {
        console.log(e);
    }
}

async function assignDistTags({ packageName, version, distTags }) {
    await Promise.each(distTags, (distTag) => {
        console.log(`Adding dist tag ${distTag} to @zillow/${packageName}@${version}`);
        // npmDistTag.add(`@zillow/${packageName}@${version}`, distTag, {})
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
    let publishedVersions = 0;

    await Promise.each(packagesToFetch, async (packageName) => {
        const unpublishedVersions = await fetchUnpublishedVersions(packageName);
        
        console.log(unpublishedVersions);
        await Promise.map(unpublishedVersions, ensureTarballOnDisk);
        await Promise.map(unpublishedVersions, async (unpublishedVersion, index, length) => {
            console.log(`Transforming tarball: ${index} / ${length}`);
            await transformTarball(TEMP_FOLDER, unpublishedVersion);
        });
    
        await Promise.each(unpublishedVersions, publishToNpm);
        await Promise.each(unpublishedVersions, assignDistTags);

        publishedVersions += unpublishedVersions.length;
    });    

    const { doc_count: finalNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);
    
    console.log(`Finished in ${Date.now() - start}ms`);
    console.log(`published versions: ${publishedVersions}`);
    console.log(`npme doc count diff: ${finalNpmeDocCount - initialNpmeDocCount}`);
}

npm.load({}, migratePackages);