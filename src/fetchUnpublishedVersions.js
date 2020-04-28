const axios = require('axios');
const Promise = require('bluebird');
const path = require('path');

const { NPME_URL, ZNPM_URL, PACKAGES_DIR } = require('./constants');

const getPackageVersionInfo = (packageName, { 'dist-tags': distTags, versions }) => {
    const versionInfo = Object.keys(versions).reduce((acc, version) => {
        const { dist } = versions[version];
        const tarballName = `${packageName}-${version}.tgz`;

        const currentVersionInfo = {
            packageName,
            version,
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

        return [...acc, currentVersionInfo];
    }, []);

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
    return Promise.reduce(packages, async (acc, package) => {
        const znpmPackageInfo = await fetchZnpmPackageInfo(package);
        const npmePublishedVersions = await fetchNpmePublishedVersions(package);

        return [
            ...acc,
            ...znpmPackageInfo.filter(({version}) => !npmePublishedVersions.includes(version))
        ];
    }, []);
}

module.exports = fetchUnpublishedVersions;