import type {PaginatedResponse} from '../types/api.types';

export function emptyPage<T>(page: number, perPage: number): PaginatedResponse<T> {
  return {
    data: [],
    meta: {current_page: page, last_page: 1, per_page: perPage, total: 0},
  };
}
