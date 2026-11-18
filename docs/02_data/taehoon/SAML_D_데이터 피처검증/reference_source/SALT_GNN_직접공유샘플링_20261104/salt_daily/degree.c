#include <stdint.h>
/* Original transaction counts; repeated/parallel transactions count separately. */
void prefix_counts(const int64_t *offsets, const uint32_t *ids,
                   const int32_t *minute, int64_t nodes, int64_t cutoff,
                   int64_t *result) {
    for (int64_t node = 0; node < nodes; ++node) {
        int64_t lo = offsets[node], hi = offsets[node + 1];
        while (lo < hi) {
            int64_t mid = lo + (hi - lo) / 2;
            if (minute[ids[mid]] < cutoff) lo = mid + 1;
            else hi = mid;
        }
        result[node] = lo - offsets[node];
    }
}

