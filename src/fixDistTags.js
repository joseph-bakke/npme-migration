const axios = require('axios');
const execa = require('execa');
const Promise = require('bluebird');
const npm = require('npm');
const { NPME_URL, ZNPM_URL} = require('./constants');

async function removeAllNpmeDistTags(packageName) {
    const packageUrl = `${NPME_URL}/@zillow%2f${packageName}`;

    try {
        const { data } = await axios.get(packageUrl, {
            headers: {
                Authorization: `Bearer ${process.env.NPME_TOKEN}`
            }
        });
        
        const distTags = data['dist-tags'];

        await Promise.each(Object.keys(distTags), async (distTag, index, length) => {
            if (distTag === 'latest') return;
            console.log(`removing ${index + 1} / ${length}`);

            return new Promise(resolve => {
                npm.commands.run(['dist-tag', 'rm', `@zillow/${packageName}`, distTag], resolve);
            });
        });
    } catch (e) {
        console.log(e);
        if (e.response.status === 404) {
            console.log(`package ${packageName} doesnt exist in npme yet`);
        }
        return [];
    }
}

async function fetchZnpmDistTags(packageName) {
    const packageUrl = `${ZNPM_URL}/@zillow%2f${packageName}`;
    try {
        const { data } = await axios.get(packageUrl);
        return data['dist-tags'];
    } catch (e) {
        console.log(e);
    }
}

async function applyDistTags({packageName, znpmDistTags}) {
    await Promise.each(Object.keys(znpmDistTags), async (distTag, index, length) => {
        const version = znpmDistTags[distTag];
        console.log(`adding dist tag ${distTag} to ${version}: ${index} / ${length} `);
        return new Promise(resolve => {
            npm.commands.run(['dist-tag', 'add', `@zillow/${packageName}@${version}`, distTag], resolve);
        });
    });
}

// in case dist tags getted messed up during migration this fixes them
async function fixDistTags() {
    const [ packageName ] = process.argv.slice(2);

    if (!packageName) {
        console.log('no package name provided');
        process.exit(1);
    }

    await removeAllNpmeDistTags(packageName);
    const znpmDistTags = await fetchZnpmDistTags(packageName);
    await applyDistTags({packageName, znpmDistTags});
}

npm.load({}, fixDistTags);