const fs = require('fs-extra');
const axios = require('axios');
const Promise = require('bluebird');
const tempy = require('tempy');
const execa = require('execa');

const transformTarball = require('./transformTarball');
const fetchUnpublishedVersions = require('./fetchUnpublishedVersions');
const { NPME_URL, ZNPM_URL, PACKAGES_DIR } = require('./constants');

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
    let command = ['publish', tarballPath];
    console.log(`publishing: npm ${command.join(' ')}`);
    await execa('npm', command, { stdio: 'inherit' });
}

async function assignDistTags({ packageName, version, distTags }) {
    Promise.each(distTags, async (distTag) => {
        await execa('npm', 'dist-tag', 'add', `${packageName}@${version}`, distTag);
    });
}

async function migratePackages() {
    await fs.ensureDir(TEMP_FOLDER);
    const packages = await fs.readdir(PACKAGES_DIR);
    const { doc_count: initialNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);

    const unpublishedVersions = await fetchUnpublishedVersions(packages);

    await Promise.each(unpublishedVersions, ensureTarballOnDisk);
    await Promise.each(unpublishedVersions, async (unpublishedVersion, index, length) => {
        console.log(`Transforming tarball: ${index} / ${length}`);
        await transformTarball(TEMP_FOLDER, unpublishedVersion);
    });
    await Promise.each(unpublishedVersions, publishToNpm);
    await Promise.each(unpublishedVersions, assignDistTags);

    const { doc_count: finalNpmeDocCount } = await getRegistryMetaInfo(NPME_URL);
    const publishedVersions = unpublishedVersions.length;
    
    console.log(`published versions: ${publishedVersions}`);
    console.log(`npme doc count diff: ${finalNpmeDocCount - initialNpmeDocCount}`);
}

migratePackages();