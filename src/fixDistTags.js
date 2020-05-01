const axios = require('axios');
const Promise = require('bluebird');
const npm = require('npm');
const npmDistTag = require('@lerna/npm-dist-tag');
const { NPME_URL, ZNPM_URL} = require('./constants');

async function removeAllNpmeDistTags(name) {
    console.log('removing dist tags from npme');
    const packageUrl = `${NPME_URL}/@zillow%2f${name}`;

    try {
        const { data } = await axios.get(packageUrl, {
            headers: {
                Authorization: `Bearer ${process.env.NPME_TOKEN}`
            }
        });
        
        const distTags = data['dist-tags'];

        console.log('got dist tags from npme');
        console.log(distTags);

        await Promise.each(Object.keys(distTags), async (distTag, index, length) => {
            if (distTag === 'latest') return;

            console.log(`removing ${index + 1} / ${length}`);
            try {
                await npmDistTag.remove(name, distTag, { registry: NPME_URL, token: process.env.NPME_TOKEN })
            } catch (e) {
                console.log(`error removing distTag: ${distTag}`);
                console.log(e);
            }
        });
    } catch (e) {
        console.log(e);
        if (e.message.includes(404)) {
            console.log(`package ${name} doesnt exist in npme yet`);
        }
        return [];
    }
}

async function fetchZnpmDistTags(name) {
    const packageUrl = `${ZNPM_URL}/@zillow%2f${name}`;
    try {
        const { data } = await axios.get(packageUrl);
        return data['dist-tags'];
    } catch (e) {
        console.log(e);
    }
}

async function applyDistTags({name, znpmDistTags}) {
    await Promise.each(Object.keys(znpmDistTags), async (distTag, index, length) => {
        const version = znpmDistTags[distTag];
        try {
            console.log(`adding dist tag ${distTag} to ${version}: ${index + 1} / ${length} `);
            await npmDistTag.add(`@zillow/${name}@${version}`, distTag, { registry: NPME_URL, token: process.env.NPME_TOKEN });
        } catch (e) {
            console.log(e);
        }
    });
}

// in case dist tags getted messed up during migration this fixes them
async function fixDistTags() {
    const [ name ] = process.argv.slice(2);

    if (!name) {
        console.log('no package name provided');
        process.exit(1);
    }

    await removeAllNpmeDistTags(name);
    const znpmDistTags = await fetchZnpmDistTags(name);
    await applyDistTags({name, znpmDistTags});
}

npm.load({}, fixDistTags);