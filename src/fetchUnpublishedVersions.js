const Promise = require('bluebird');
const path = require('path');
const semver = require('semver');
const pacote = require('pacote');

const { NPME_URL, ZNPM_URL } = require('./constants');

const getPackageVersionInfo = (name, { 'dist-tags': distTags, versions }) => {
    const [ packagesDir ] = process.argv.slice(2);
    const versionInfo = Object.keys(versions).reduce((acc, version) => {
        const tarballName = `${name}-${version}.tgz`;
        const manifest = {
            ...versions[version],
            distTags: [],
            tarballPath: path.resolve(packagesDir, name, '_attachments', tarballName)
        };

        Object.keys(distTags).forEach(distTag => {
            const distTagVersion = distTags[distTag];

            if (version === distTagVersion) {
                manifest.distTags = [...manifest.distTags, distTag];
            }
        })

        // dont publish pre releases without a dist tag
        if (semver.prerelease(version) !== null && manifest.distTags.length === 0) {
            return acc;
        }
        
        return [...acc, manifest];
    }, []);

    versionInfo.sort((a, b) => semver.compare(a.version, b.version));

    return versionInfo;
}

async function fetchZnpmPackageInfo(name) {
    try {
        const packageInfo = await pacote.packument(`@zillow/${name}`, { registry: ZNPM_URL })
        return getPackageVersionInfo(name, packageInfo);
    } catch (e) {
        if (e.message.includes('404')) {
            console.log(`@zillow/${name} not found in ZNPM.`);
        }
    }

    return [];
}

async function fetchNpmePublishedVersions(name) {
    try {
        const packageInfo = await pacote.packument(`@zillow/${name}`, { registry: NPME_URL, token: process.env.NPME_TOKEN });
        return Object.keys(packageInfo.versions);
    } catch (e) {
        if (e.message.includes('404')) {
            console.log(`@zillow/${name} not found in NPME.`);
        }
    }

    return [];
}

async function fetchUnpublishedVersions(name) {
        const znpmPackageInfo = await fetchZnpmPackageInfo(name);
        const npmePublishedVersions = await fetchNpmePublishedVersions(name);

        return znpmPackageInfo.filter(({version}) => !npmePublishedVersions.includes(version))
}

module.exports = fetchUnpublishedVersions;