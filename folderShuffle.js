// @ts-check

// NAME: folderShuffle
// AUTHOR: jtrain
// DESCRIPTION: Shuffle playlists in a folder not songs.

/// <reference path="../globals.d.ts" />

(function FolderShuffle() {
    if (!(Spicetify.CosmosAsync && Spicetify.Platform)) {
        setTimeout(FolderShuffle, 1000);
        return;
    }

    let playerPlayOGFunc = Spicetify.Platform.PlayerAPI.play.bind(Spicetify.Platform.PlayerAPI);
    let isInjected = localStorage.getItem("foldershuffle:on") === "true";
    // injectFunctions(isInjected);

    function injectFunctions(bool) {
        if (bool) {
            Spicetify.Platform.PlayerAPI.play = (uri, origins, options) => {
                if (options?.skipTo) {
                    if (options.skipTo.index !== undefined) {
                        playerPlayOGFunc(uri, origins, options);
                        return;
                    } else if (options.skipTo.pageIndex !== undefined) {
                        uri.uri = options.skipTo.fallbackContextURI;
                    } else {
                        throw "No idea what to do. Please report on Github repo, specify which page you are in.";
                    }
                }
                fetchAndPlay(uri.uri);
            };
        } else {
            // Revert
            Spicetify.Platform.PlayerAPI.play = playerPlayOGFunc;
        }
    }

    // Text of notification when queue is shuffled successfully
    /** @param {number} count */
    const NOTIFICATION_TEXT = (count) => `Shuffled ${count} playlists!`;

    const cntxMenu = new Spicetify.ContextMenu.Item(
        "Shuffle this folder",
        (uris) => {
            if (uris.length === 1) {
                fetchAndPlay(uris[0]);
                return;
            }
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
            return false;
        },
        "shuffle"
    );
    cntxMenu.register();

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
        const res = await Spicetify.CosmosAsync.get(`sp://core-playlist/v1/playlist/${uri}/rows`, {
            policy: { link: true },
        });
        return res.rows.map((item) => item.link);
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
     * @returns {playlists: Promise<string[]>, count: integer}
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
        let albumCount = 0;
        const fetchNested = async (folder) => {
            if (!folder.rows) return;

            for (const i of folder.rows) {
                if (i.type === "playlist") {
                    albumCount++;
                    requestPlaylists.push(await fetchPlaylist(i.link));
                }
                else if (i.type === "folder") fetchNested(i);
            }
        };

        await fetchNested(requestFolder);

        playlists = shuffle(requestPlaylists).flat();
        return {playlists: playlists, albumCount: albumCount};
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

        // Re-shuffle if first item is the same as pre-shuffled first item
        while (array[0] === first) {
            array = shuffle(array);
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
    async function playList(list, context, albumCount) {
        const count = list.length;
        if (count === 0) {
            throw "There is no available track to play";
        } else if (count === 1) {
            playerPlayOGFunc({ uri: list[0] }, { featureVersion: Spicetify.Platform.PlayerAPI._defaultFeatureVersion });
            return;
        }
        list.push("spotify:delimiter");

        const { _queue, _client } = Spicetify.Platform.PlayerAPI._queue;
        const { prevTracks, queueRevision } = _queue;


        const nextTracks = list.map(uri => ({
            contextTrack: {
                uri,
                uid: "",
                metadata: {
                    is_queued: "false"
                }
            },
            removed: [],
            blocked: [],
            provider: "context"
        }));

        _client.setQueue({
            nextTracks,
            prevTracks,
            queueRevision
        });

        if (context) {
            const {sessionId} = Spicetify.Platform.PlayerAPI.getState();
            Spicetify.PlayerAPI.updateContext(sessionId, {uri: context, url: "context://" + context});
        }

        success(albumCount);
        Spicetify.Player.next();
    }

    function fetchAndPlay(uri) {
        fetchListFromUri(uri)
            .then((result) => playList(result.playlists, null, result.albumCount))
            .catch((err) => Spicetify.showNotification(`${err}`));
    }
})();
