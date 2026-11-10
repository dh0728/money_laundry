#include <stdint.h>
#include <stdlib.h>

/* Chronological CSR traversal: an unseen counterparty receives the next port.
   No amount, currency, label or future degree is an input to the rank. */
int build_ports(int64_t nodes, const int64_t *offsets, const uint32_t *ids,
                const int32_t *counterpart, int32_t *result) {
    for (int64_t node = 0; node < nodes; ++node) {
        int64_t count = offsets[node + 1] - offsets[node];
        if (!count) continue;
        size_t capacity = 2;
        while (capacity < (size_t)count * 2) capacity *= 2;
        int32_t *keys = malloc(capacity * sizeof(int32_t));
        int32_t *values = malloc(capacity * sizeof(int32_t));
        if (!keys || !values) { free(keys); free(values); return 0; }
        for (size_t i = 0; i < capacity; ++i) keys[i] = -1;
        int32_t next_port = 0;
        for (int64_t j = offsets[node]; j < offsets[node + 1]; ++j) {
            uint32_t edge = ids[j];
            int32_t peer = counterpart[edge];
            size_t slot = ((uint32_t)peer * 2654435761U) & (capacity - 1);
            while (keys[slot] != -1 && keys[slot] != peer) slot = (slot + 1) & (capacity - 1);
            if (keys[slot] == -1) { keys[slot] = peer; values[slot] = next_port++; }
            result[edge] = values[slot];
        }
        free(keys);
        free(values);
    }
    return 1;
}
