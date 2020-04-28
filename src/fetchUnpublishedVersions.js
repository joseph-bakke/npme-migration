const axios = require('axios');
const Promise = require('bluebird');
const path = require('path');
const semver = require('semver');

const { NPME_URL, ZNPM_URL, PACKAGES_DIR } = require('./constants');

const isPreRelease = (version) => version.match(/(\d+\.\d+\.\d+-.*)/g) !== null;

const getPackageVersionInfo = (packageName, { 'dist-tags': distTags, versions }) => {
    const versionInfo = Object.keys(versions).reduce((acc, version) => {
        const { dist, description } = versions[version];
        const tarballName = `${packageName}-${version}.tgz`;
        const currentVersionInfo = {
            packageName,
            version,
            description,
            distTags: [],
            tarballUrl: `${dist.tarball}`,
            tarballPath: path.resolve(PACKAGES_DIR, packageName, '_attachments', tarballName)
        };

        Object.keys(distTags).forEach(distTag => {
            const distTagVersion = distTags[distTag];

            if (version === distTagVersion) {
                currentVersionInfo.distTags = [...currentVersionInfo.distTags, distTag];
            }
        })

        if (isPreRelease(version) && currentVersionInfo.distTags.length === 0) {
            return acc;
        }

        return [...acc, currentVersionInfo];
    }, []);

    versionInfo.sort((a, b) => semver.compare(a.version, b.version));

    return versionInfo;
}

async function fetchZnpmPackageInfo(packageName) {
    const packageUrl = `${ZNPM_URL}/@zillow%2f${packageName}`;
    const { data } = await axios.get(packageUrl);

    return getPackageVersionInfo(packageName, data);
}

async function fetchNpmePublishedVersions(packageName) {
    const packageUrl = `${NPME_URL}/@zillow%2f${packageName}`;

    try {
        const { data } = await axios.get(packageUrl, {
            headers: {
                Authorization: `Bearer ${process.env.NPME_TOKEN}`
            }
        });
        return Object.keys(data.versions);
    } catch (e) {
        if (e.response.status === 404) {
            console.log(`package ${packageName} doesnt exist in npme yet`);
        }
        return [];
    }
}

async function fetchUnpublishedVersions(packages) {
    return Promise.reduce(packages, async (acc, packageName) => {
        const znpmPackageInfo = await fetchZnpmPackageInfo(packageName);
        const npmePublishedVersions = await fetchNpmePublishedVersions(packageName);

        return [
            ...acc,
            ...znpmPackageInfo.filter(({version}) => !npmePublishedVersions.includes(version))
        ];
    }, []);
}

module.exports = fetchUnpublishedVersions;