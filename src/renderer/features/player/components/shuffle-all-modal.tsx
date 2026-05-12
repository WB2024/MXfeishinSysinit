import { closeAllModals, openContextModal } from '@mantine/modals';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import merge from 'lodash/merge';
import { Suspense, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { createWithEqualityFn } from 'zustand/traditional';

import i18n from '/@/i18n/i18n';
import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { useGenreList } from '/@/renderer/features/genres/api/genres-api';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { PlayButtonGroup } from '/@/renderer/features/shared/components/play-button-group';
import { useCurrentServer } from '/@/renderer/store';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Divider } from '/@/shared/components/divider/divider';
import { Group } from '/@/shared/components/group/group';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Stack } from '/@/shared/components/stack/stack';
import {
    AlbumListSort,
    LibraryItem,
    Played,
    RandomSongListQuery,
    ServerType,
    SortOrder,
} from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

interface ShuffleAllSlice extends RandomSongListQuery {
    actions: {
        setStore: (data: Partial<ShuffleAllSlice>) => void;
    };
    enableMaxYear: boolean;
    enableMinYear: boolean;
    playbackKind: 'albums' | 'songs';
}

const useShuffleAllStore = createWithEqualityFn<ShuffleAllSlice>()(
    persist(
        immer((set, get) => ({
            actions: {
                setStore: (data) => {
                    set({ ...get(), ...data });
                },
            },
            enableMaxYear: false,
            enableMinYear: false,
            genre: '',
            limit: 100,
            maxYear: 2020,
            minYear: 2000,
            musicFolder: '',
            playbackKind: 'songs',
            played: Played.All,
        })),
        {
            merge: (persistedState, currentState) => merge(currentState, persistedState),
            migrate: (
                persisted: Partial<ShuffleAllSlice & { playbackKind?: string; songCount?: number }>,
                version: number,
            ) => {
                if (!persisted) {
                    return persisted;
                }

                if (version >= 2) {
                    return persisted;
                }

                const songCountFallback =
                    typeof persisted.songCount === 'number' ? persisted.songCount : 100;

                return {
                    ...persisted,
                    limit:
                        persisted.limit !== undefined && persisted.limit !== null
                            ? persisted.limit
                            : songCountFallback,
                    playbackKind:
                        persisted.playbackKind === 'albums' || persisted.playbackKind === 'songs'
                            ? persisted.playbackKind
                            : 'songs',
                };
            },
            name: 'store_shuffle_all',
            version: 2,
        },
    ),
);

const PLAYED_DATA: { label: string; value: Played }[] = [
    { label: 'all tracks', value: Played.All },
    { label: 'only unplayed tracks', value: Played.Never },
    { label: 'only played tracks', value: Played.Played },
];

export const useShuffleAllStoreActions = () => useShuffleAllStore((state) => state.actions);

export const ShuffleAllContextModal = () => {
    const queryClient = useQueryClient();
    const server = useCurrentServer();
    const { addToQueueByData, addToQueueByFetch } = usePlayer();
    const { t } = useTranslation();
    const {
        enableMaxYear,
        enableMinYear,
        genre,
        limit,
        maxYear,
        minYear,
        musicFolderId,
        playbackKind,
        played,
    } = useShuffleAllStore();
    const { setStore } = useShuffleAllStoreActions();

    const { isFetching, refetch } = useQuery({
        ...randomFetchQuery({
            query: {
                genre: genre || undefined,
                limit: limit || 100,
                maxYear: enableMaxYear ? maxYear || undefined : undefined,
                minYear: enableMinYear ? minYear || undefined : undefined,
                musicFolderId: musicFolderId || undefined,
                played,
            },
            serverId: server.id,
        }),
        enabled: false,
        gcTime: 0,
        staleTime: 0,
    });

    const fetchTypeRef = useRef<Play>(null);
    const [isFetchingAlbums, setIsFetchingAlbums] = useState(false);

    const clampedLimit = Math.min(500, Math.max(1, limit || 100));

    const handlePlay = async (playType: Play) => {
        fetchTypeRef.current = playType;

        if (playbackKind === 'albums') {
            setIsFetchingAlbums(true);

            try {
                const albumListResult = await queryClient.fetchQuery({
                    ...albumQueries.list({
                        query: {
                            genreIds: genre ? [genre] : undefined,
                            limit: clampedLimit,
                            maxYear: enableMaxYear ? maxYear || undefined : undefined,
                            minYear: enableMinYear ? minYear || undefined : undefined,
                            musicFolderId: musicFolderId || undefined,
                            sortBy: AlbumListSort.RANDOM,
                            sortOrder: SortOrder.ASC,
                            startIndex: 0,
                        },
                        serverId: server.id,
                    }),
                    gcTime: 0,
                    staleTime: 0,
                });

                await addToQueueByFetch(
                    server.id,
                    albumListResult.items.map((a) => a.id),
                    LibraryItem.ALBUM,
                    playType,
                );
            } finally {
                setIsFetchingAlbums(false);
            }
        } else {
            const { data } = await refetch();

            addToQueueByData(data?.items || [], playType);
        }

        closeAllModals();
    };

    return (
        <Stack gap="md">
            <SegmentedControl
                data={[
                    {
                        label: t('form.shuffleAll.input_kind_songs'),
                        value: 'songs',
                    },
                    {
                        label: t('form.shuffleAll.input_kind_albums'),
                        value: 'albums',
                    },
                ]}
                onChange={(value) =>
                    setStore({
                        playbackKind: value as 'albums' | 'songs',
                    })
                }
                size="sm"
                value={playbackKind}
                w="100%"
            />
            <NumberInput
                label={
                    playbackKind === 'albums'
                        ? t('form.shuffleAll.input_limit_albums')
                        : t('form.shuffleAll.input_limit_songs')
                }
                max={500}
                min={1}
                onChange={(e) => setStore({ limit: e ? Number(e) : 500 })}
                required
                value={limit}
            />
            <Group grow>
                <NumberInput
                    label={t('form.shuffleAll.input_minYear')}
                    max={2050}
                    min={1850}
                    onChange={(e) => setStore({ minYear: e ? Number(e) : 0 })}
                    rightSection={
                        <Checkbox
                            checked={enableMinYear}
                            onChange={(e) => setStore({ enableMinYear: e.currentTarget.checked })}
                            style={{ marginRight: '0.5rem' }}
                        />
                    }
                    value={minYear}
                />
                <NumberInput
                    label={t('form.shuffleAll.input_maxYear')}
                    max={2050}
                    min={1850}
                    onChange={(e) => setStore({ maxYear: e ? Number(e) : 0 })}
                    rightSection={
                        <Checkbox
                            checked={enableMaxYear}
                            onChange={(e) => setStore({ enableMaxYear: e.currentTarget.checked })}
                            style={{ marginRight: '0.5rem' }}
                        />
                    }
                    value={maxYear}
                />
            </Group>
            <Suspense fallback={<Select data={[]} />}>
                <GenreSelect />
            </Suspense>
            {server?.type === ServerType.JELLYFIN && playbackKind === 'songs' && (
                <Select
                    clearable
                    data={PLAYED_DATA}
                    label={t('form.shuffleAll.input_played')}
                    onChange={(e) => {
                        setStore({ played: e as Played });
                    }}
                    value={played}
                />
            )}
            <Divider />
            <PlayButtonGroup
                loading={
                    (playbackKind === 'songs' && isFetching && fetchTypeRef.current) ||
                    (playbackKind === 'albums' && isFetchingAlbums && fetchTypeRef.current)
                }
                onPlay={handlePlay}
            />
        </Stack>
    );
};

const randomFetchQuery = (args: {
    query: {
        genre?: string;
        limit: number;
        maxYear?: number;
        minYear?: number;
        musicFolderId?: string | string[];
        played: Played;
    };
    serverId: string;
}) => {
    return queryOptions({
        queryFn: async ({ signal }) => {
            return api.controller.getRandomSongList({
                apiClientProps: { serverId: args.serverId, signal },
                query: args.query,
            });
        },
        queryKey: queryKeys.player.fetch(),
    });
};

export const openShuffleAllModal = async () => {
    openContextModal({
        innerProps: {},
        modal: 'shuffleAll',
        size: 'sm',
        title: i18n.t('player.playRandom') as string,
    });
};

const GenreSelect = () => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const { genre } = useShuffleAllStore();
    const { data: genres } = useGenreList();
    const { setStore } = useShuffleAllStoreActions();

    const genreData = useMemo(() => {
        if (!genres) return [];

        return genres.items.map((genre) => {
            const value =
                server?.type === ServerType.NAVIDROME || server?.type === ServerType.SUBSONIC
                    ? genre.name
                    : genre.id;
            return {
                label: genre.name,
                value,
            };
        });
    }, [genres, server.type]);

    return (
        <Select
            clearable
            data={genreData}
            label={t('form.shuffleAll.input_genre')}
            onChange={(e) => setStore({ genre: e || '' })}
            searchable
            value={genre}
        />
    );
};
