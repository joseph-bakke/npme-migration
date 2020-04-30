const Promise = require('bluebird');
const path = require('path');
const semver = require('semver');
const pacote = require('pacote');

const { NPME_URL, ZNPM_URL } = require('./constants');

const getPackageVersionInfo = (packageName, { 'dist-tags': distTags, versions }) => {
    const [ packagesDir ] = process.argv.slice(2);
    const versionInfo = Object.keys(versions).reduce((acc, version) => {
        const { dist, description, readme } = versions[version];
        const tarballName = `${packageName}-${version}.tgz`;
        const currentVersionInfo = {
            name: packageName,
            version,
            description,
            readme,
            distTags: [],
            tarballUrl: `${dist.tarball}`,
            tarballPath: path.resolve(packagesDir, packageName, '_attachments', tarballName)
        };

        Object.keys(distTags).forEach(distTag => {
            const distTagVersion = distTags[distTag];

            if (version === distTagVersion) {
                currentVersionInfo.distTags = [...currentVersionInfo.distTags, distTag];
            }
        })

        // dont publish pre releases without a dist tag
        if (semver.prerelease(version) !== null && currentVersionInfo.distTags.length === 0) {
            return acc;
        }

        return [...acc, currentVersionInfo];
    }, []);

    versionInfo.sort((a, b) => semver.compare(a.version, b.version));

    return versionInfo;
}

async function fetchZnpmPackageInfo(packageName) {
    try {
        const packageInfo = await pacote.packument(`@zillow/${packageName}`, { registry: ZNPM_URL })
        return getPackageVersionInfo(packageName, packageInfo);
    } catch (e) {
        if (e.message.includes('404')) {
            console.log(`@zillow/${packageName} not found in ZNPM.`);
        }
    }

    return [];
}

async function fetchNpmePublishedVersions(packageName) {
    try {
        const packageInfo = await pacote.packument(`@zillow/${packageName}`, { registry: NPME_URL, token: process.env.NPME_TOKEN });
        return Object.keys(packageInfo.versions);
    } catch (e) {
        if (e.message.includes('404')) {
            console.log(`@zillow/${packageName} not found in NPME.`);
        }
    }

    return [];
}

async function fetchUnpublishedVersions(packageName) {
        const znpmPackageInfo = await fetchZnpmPackageInfo(packageName);
        const npmePublishedVersions = await fetchNpmePublishedVersions(packageName);

        return znpmPackageInfo.filter(({version}) => !npmePublishedVersions.includes(version))
}

module.exports = fetchUnpublishedVersions;