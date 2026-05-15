import { ipcMain } from 'electron';
import Player from 'mpris-service';

import { getMainWindow } from '/@/main/index';
import { QueueSong } from '/@/shared/types/domain-types';
import { PlayerRepeat, PlayerStatus } from '/@/shared/types/types';

// [sysvinit-compat] Wrap Player() in a function so D-Bus registration failure
// is non-fatal. If mpris-service cannot connect to the session bus, initMpris()
// returns null and no event handlers are registered. On a working session bus
// (standard systemd and sysvinit desktops with dbus-launch) this is a no-op.
function initMpris(): ReturnType<typeof Player> | null {
    let player: ReturnType<typeof Player>;

    try {
        player = Player({
            identity: 'Feishin',
            maximumRate: 1.0,
            minimumRate: 1.0,
            name: 'Feishin',
            rate: 1.0,
            supportedInterfaces: ['player'],
            supportedMimeTypes: ['audio/mpeg', 'application/ogg'],
            supportedUriSchemes: ['file'],
        });
    } catch (e) {
        console.warn('[sysvinit-compat] MPRIS D-Bus registration failed — MPRIS unavailable:', e);
        return null;
    }

    player.on('quit', () => {
        process.exit();
    });

    const hasData = (): boolean => {
        return player.metadata && !!player.metadata['mpris:length'];
    };

    player.on('stop', () => {
        getMainWindow()?.webContents.send('renderer-player-stop');
        player.playbackStatus = 'Paused';
    });

    player.on('pause', () => {
        if (!hasData()) return;
        getMainWindow()?.webContents.send('renderer-player-pause');
        player.playbackStatus = 'Paused';
    });

    player.on('play', () => {
        if (!hasData()) return;
        getMainWindow()?.webContents.send('renderer-player-play');
        player.playbackStatus = 'Playing';
    });

    player.on('playpause', () => {
        if (!hasData()) return;
        getMainWindow()?.webContents.send('renderer-player-play-pause');
        if (player.playbackStatus !== 'Playing') {
            player.playbackStatus = 'Playing';
        } else {
            player.playbackStatus = 'Paused';
        }
    });

    player.on('next', () => {
        if (!hasData()) return;
        getMainWindow()?.webContents.send('renderer-player-next');

        if (player.playbackStatus !== 'Playing') {
            player.playbackStatus = 'Playing';
        }
    });

    player.on('previous', () => {
        if (!hasData()) return;
        getMainWindow()?.webContents.send('renderer-player-previous');

        if (player.playbackStatus !== 'Playing') {
            player.playbackStatus = Player.PLAYBACK_STATUS_PLAYING;
        }
    });

    player.on('volume', (vol: number) => {
        let volume = Math.round(vol * 100);

        if (volume > 100) {
            volume = 100;
        } else if (volume < 0) {
            volume = 0;
        }

        getMainWindow()?.webContents.send('request-volume', {
            volume,
        });

        player.volume = volume / 100;
    });

    player.on('shuffle', (event: boolean) => {
        getMainWindow()?.webContents.send('mpris-request-toggle-shuffle', { shuffle: event });
        player.shuffle = event;
    });

    player.on('loopStatus', (event: string) => {
        getMainWindow()?.webContents.send('mpris-request-toggle-repeat', { repeat: event });
        player.loopStatus = event;
    });

    player.on('position', (event: any) => {
        getMainWindow()?.webContents.send('request-position', {
            position: event.position / 1e6,
        });
    });

    player.on('seek', (event: number) => {
        getMainWindow()?.webContents.send('request-seek', {
            offset: event / 1e6,
        });
    });

    player.on('raise', () => {
        getMainWindow()?.show();
    });

    ipcMain.on('update-position', (_event, arg: number) => {
        player.getPosition = () => arg * 1e6;
    });

    ipcMain.on('update-seek', (_event, arg) => {
        player.seeked(arg * 1e6);
    });

    ipcMain.on('update-volume', (_event, volume) => {
        player.volume = Number(volume) / 100;
    });

    ipcMain.on('update-playback', (_event, status: PlayerStatus) => {
        player.playbackStatus = status === PlayerStatus.PLAYING ? 'Playing' : 'Paused';
    });

    const REPEAT_TO_MPRIS: Record<PlayerRepeat, string> = {
        [PlayerRepeat.ALL]: 'Playlist',
        [PlayerRepeat.NONE]: 'None',
        [PlayerRepeat.ONE]: 'Track',
    };

    ipcMain.on('update-repeat', (_event, arg: PlayerRepeat) => {
        player.loopStatus = REPEAT_TO_MPRIS[arg];
    });

    ipcMain.on('update-shuffle', (_event, shuffle: boolean) => {
        player.shuffle = shuffle;
    });

    ipcMain.on(
        'update-song',
        (_event, song: QueueSong | undefined, imageUrl: null | string | undefined) => {
            try {
                if (!song?.id) {
                    player.metadata = {};
                    return;
                }

                // If the served id is an empty string, this is a radio
                // Use a limited subset of the fields
                if (song._serverId === '') {
                    // The id as passed in from use-mpris is radio- plus the radio ID
                    // If there are spaces or some other characters, this causes MPRIS to error and
                    // disconnect the bus. To prevent this, just use a fake track/radio
                    player.metadata = {
                        'mpris:trackid': player.objectPath(`track/radio`),
                        'xesam:album': song.album || null,
                        'xesam:artist': song.artists?.length
                            ? song.artists.map((artist) => artist.name)
                            : null,
                        'xesam:title': song.name || null,
                    };
                    return;
                }

                player.metadata = {
                    'mpris:artUrl': imageUrl || null,
                    'mpris:length': song.duration ? Math.round((song.duration || 0) * 1e3) : null,
                    'mpris:trackid': song.id
                        ? player.objectPath(`track/${song.id?.replace('-', '')}`)
                        : '',
                    'xesam:album': song.album || null,
                    'xesam:albumArtist': song.albumArtists?.length
                        ? song.albumArtists.map((artist) => artist.name)
                        : null,
                    'xesam:artist': song.artists?.length
                        ? song.artists.map((artist) => artist.name)
                        : null,
                    'xesam:audioBpm': song.bpm,
                    // Comment is a `list of strings` type
                    'xesam:comment': song.comment ? [song.comment] : null,
                    'xesam:contentCreated': song.releaseDate,
                    'xesam:discNumber': song.discNumber ? song.discNumber : null,
                    'xesam:genre': song.genres?.length
                        ? song.genres.map((genre: any) => genre.name)
                        : null,
                    'xesam:lastUsed': song.lastPlayedAt,
                    'xesam:title': song.name || null,
                    'xesam:trackNumber': song.trackNumber ? song.trackNumber : null,
                    'xesam:useCount':
                        song.playCount !== null && song.playCount !== undefined
                            ? song.playCount
                            : null,
                    // User ratings are only on Navidrome/Subsonic and are on a scale of 1-5
                    'xesam:userRating': song.userRating ? song.userRating / 5 : null,
                };
            } catch (err) {
                console.error(err);
            }
        },
    );

    return player;
}

export const mprisPlayer = initMpris();
