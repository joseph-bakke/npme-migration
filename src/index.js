#!/usr/bin/env node

const fs = require('fs-extra');
const axios = require('axios');
const Promise = require('bluebird');
const tempy = require('tempy');
const npm = require('npm');

const transformTarball = require('./transformTarball');
const fetchUnpublishedVersions = require('./fetchUnpublishedVersions');
const { NPME_URL, PACKAGES_DIR } = require('./constants');

const TEMP_FOLDER = tempy.directory();

async function getRegistryMetaInfo(registryUrl) {
    const { data } = await axios.get(registryUrl);
    return data;
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

async function publishToNpm({ tarballPath }) {
    try {
        return new Promise((resolve) => {
            npm.commands.publish([tarballPath], (err) => {
                if (err) {
                    console.log(err);
                }
                resolve();
            });
        });
    } catch (e) {
        console.log(e);
    }
}

async function assignDistTags({ packageName, version, distTags }) {
    await Promise.each(distTags, async (distTag) => {
        console.log('npm', ['dist-tag', 'add', `@zillow/${packageName}@${version}`, distTag].join(' '));
        return new Promise((resolve) => {
            npm.commands.run(['dist-tag', 'add', `@zillow/${packageName}@${version}`, distTag], resolve);   
        })
    });
}

async function migratePackages() {
    const start = Date.now();
    await fs.ensureDir(TEMP_FOLDER);
    const packages = await fs.readdir(PACKAGES_DIR);
    const { doc_count: initialNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);

    const [ specificPackage ] = process.argv.slice(2);
    const packagesToFetch = specificPackage ? [specificPackage] : packages;

    const unpublishedVersions = (await fetchUnpublishedVersions(packagesToFetch));

    console.log(unpublishedVersions);
    
    await Promise.map(unpublishedVersions, ensureTarballOnDisk);
    await Promise.map(unpublishedVersions, async (unpublishedVersion, index, length) => {
        console.log(`Transforming tarball: ${index} / ${length}`);
        await transformTarball(TEMP_FOLDER, unpublishedVersion);
    });

    await Promise.each(unpublishedVersions, publishToNpm);
    await Promise.each(unpublishedVersions, assignDistTags);

    const { doc_count: finalNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);
    const publishedVersions = unpublishedVersions.length;
    
    console.log(`Finished in ${Date.now() - start}ms`);
    console.log(`published versions: ${publishedVersions}`);
    console.log(`npme doc count diff: ${finalNpmeDocCount - initialNpmeDocCount}`);
}

npm.load({}, migratePackages);