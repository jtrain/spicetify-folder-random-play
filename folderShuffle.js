// @ts-check

// NAME: folderShuffle
// AUTHOR: jtrain
// DESCRIPTION: Shuffle playlists in a folder not songs.

/// <reference path="../globals.d.ts" />

(async function folderShuffle() {
    if (!(Spicetify.CosmosAsync && Spicetify.Platform)) {
        setTimeout(ShuffleFolder, 300);
        return;
    }
    await initShuffleFolder();
});

async function initShuffleFolder() {

    async function getFromStorage(key) {
        return Spicetify.LocalStorage.get(key);
    }
    async function setToStorage(key, value) {
        Spicetify.LocalStorage.set(key, value);
    }

    let isInjected = getFromStorage('shufflefolder:on')  === "true";

    const autoShuffleMenu = new Spicetify.Menu.Item("Folder shuffle", isInjected, (menuItem) => {
        isInjected = !isInjected;
        setToStorage("shufflefolder:on", String(isInjected));
        menuItem.isEnabled = isInjected;
    });

    new Spicetify.Menu.SubMenu("Folder Shuffle", [autoShuffleMenu]).register();

    // Text of notification when queue is shuffled successfully
    /** @param {number} count */
    const NOTIFICATION_TEXT = (count) => `Shuffled ${count} playlists!`;

    const cntxMenu = new Spicetify.ContextMenu.Item(
        "Shuffle playlists",
        (uris) => {
            if (uris.length === 1) {
                await fetchAndPlay(uris[0]);
                return;
            }

            await Queue(uris);
        },
        (uris) => {
            if (uris.length === 1) {
                const uriObj = Spicetify.URI.fromString(uris[0]);
                switch (uriObj.type) {
                    case Spicetify.URI.Type.FOLDER:
                        return true;
                }
                return false;
            }
            // User selects multiple tracks in a list.
            return true;
        },
        "folder-shuffle"
    ).register();

    /**
     *
     * @param {string} uri
     * @returns {songs: Promise<string[]>, albumCount: integer}
     */
    async function fetchListFromUri(uri) {
        const uriObj = Spicetify.URI.fromString(uri);

        switch (uriObj.type) {
            case Spicetify.URI.Type.FOLDER:
                return await fetchFolder(uri);
        }
        throw `Unsupported fetching URI type: ${uriObj.type}`;
    }

    /**
     *
     * @param {string} uri
     * @returns {Promise<string[]>}
     */
    const fetchPlaylist = async (uri) => {
        const res = await Spicetify.CosmosAsync.get(`sp://core-playlist/v1/playlist/spotify:playlist:${uri}/rows`, {
            policy: { link: true, playable: true },
        });
        return res.rows.filter(track => track.playable).map((item) => item.link);
    };

    /**
     *
     * @param {object} rows
     * @param {string} uri
     * @returns {object} folder
     */
    const searchFolder = (rows, uri) => {
        for (const r of rows) {
            if (r.type !== "folder" || r.rows == null) {
                continue;
            }

            if (r.link === uri) {
                return r;
            }

            const found = searchFolder(r.rows, uri);
            if (found) return found;
        }
    };

    /**
     *
     * @param {string} uri
     * @returns {Promise<string[]>}
     */
    const fetchFolder = async (uri) => {
        const res = await Spicetify.CosmosAsync.get(`sp://core-playlist/v1/rootlist`, {
            policy: { folder: { rows: true, link: true } },
        });

        const requestFolder = searchFolder(res.rows, uri);
        if (requestFolder == null) {
            throw "Cannot find folder";
        }

        let requestPlaylists = [];
        async function fetchNested(folder) {
            if (!folder.rows) return;

            for (const i of folder.rows) {
                if (i.type === "playlist") requestPlaylists.push(await fetchPlaylist(i.link.split(":")[2]));
                else if (i.type === "folder") await fetchNested(i);
            }
        };

        await fetchNested(requestFolder);

        songs = shuffle(requestPlaylists).flat()
        return {songs: songs, albumCount: requestPlaylists.length};
    };

    /**
     *
     * @param {string[]} array list of items to shuffle
     * @returns {string[]} shuffled array
     *
     * From: https://bost.ocks.org/mike/shuffle/
     */
    function shuffle(array) {
        let counter = array.length;
        if (counter <= 1) return array;

        const first = array[0];

        // While there are elements in the array
        while (counter > 0) {
            // Pick a random index
            let index = Math.floor(Math.random() * counter);

            // Decrease counter by 1
            counter--;

            // And swap the last element with it
            let temp = array[counter];
            array[counter] = array[index];
            array[index] = temp;
        }

        return array;
    }

    /**
     *
     * @param {number} total
     */
    function success(total) {
        Spicetify.showNotification(NOTIFICATION_TEXT(total));
    }

    /**
     * Replace queue and play first track immediately.
     * @param {string[]} list
     */
    async function Queue(list, context=null, albumCount) {
        const count = list.length;
        if (count === 0) {
            throw "There is no available track to play";
        }
        list.push("spotify:delimiter");

	await Spicetify.Platform.PlayerAPI.clearQueue();

        const isQueue = !context;


        await Spicetify.CosmosAsync.put("sp://player/v2/main/queue", {
                queue_revision: Spicetify.Queue?.queueRevision,
                next_tracks: list.map(uri => ({
                        uri,
                        provider: isQueue ? "queue" : "context",
                        metadata: {
                                is_queued: isQueue
                        }
                })),
                prev_tracks: Spicetify.Queue?.prevTracks
        });

        if (!isQueue) {
            await Spicetify.CosmosAsync.post("sp://player/v2/main/update", {
                context: {
                    uri: context,
                    url: "context://" + context,
                },
            });
        }

        success(albumCount);
        Spicetify.Player.next();
    }


    async function fetchAndPlay(uri) {
        await fetchListFromUri(uri)
            .then((result) => await Queue(result.songs, uri, result.albumCount))
            .catch((err) => Spicetify.showNotification(`${err}`));
    }
};
