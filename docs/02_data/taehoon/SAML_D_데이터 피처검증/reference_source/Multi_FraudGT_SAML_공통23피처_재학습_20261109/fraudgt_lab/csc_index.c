/* Only convert an existing chronological index to CSC. No sampling here. */
#include <stdint.h>

void count_prefix(const int64_t *old_ptr, const uint32_t *ids,
                  const int32_t *minute, int64_t nodes, int64_t cutoff,
                  int64_t *ptr) {
    ptr[0] = 0;
    for (int64_t n = 0; n < nodes; ++n) {
        int64_t lo = old_ptr[n], hi = old_ptr[n + 1];
        while (lo < hi) {
            int64_t mid = lo + (hi - lo) / 2;
            if (minute[ids[mid]] < cutoff) lo = mid + 1;
            else hi = mid;
        }
        ptr[n + 1] = ptr[n] + lo - old_ptr[n];
    }
}

void write_prefix(const int64_t *old_ptr, const uint32_t *ids,
                  const int32_t *peer, int64_t nodes, const int64_t *ptr,
                  int64_t *row, uint32_t *edge_ids) {
    for (int64_t n = 0; n < nodes; ++n) {
        int64_t begin = old_ptr[n], count = ptr[n + 1] - ptr[n];
        for (int64_t j = 0; j < count; ++j) {
            uint32_t edge = ids[begin + j];
            row[ptr[n] + j] = peer[edge];
            edge_ids[ptr[n] + j] = edge;
        }
    }
}
