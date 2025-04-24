import { SetupMixFetchOps } from '@nymproject/mix-fetch-full-fat'

export const mixFetchOptions: SetupMixFetchOps = {
  preferredGateway: '5rXcNe2a44vXisK3uqLHCzpzvEwcnsijDMU7hg4fcYk8', // with WSS
  preferredNetworkRequester:
    '5x6q9UfVHs5AohKMUqeivj7a556kVVy7QwoKige8xHxh.6CFoB3kJaDbYz6oafPJxNxNjzahpT2NtgtytcSyN9EvF@5rXcNe2a44vXisK3uqLHCzpzvEwcnsijDMU7hg4fcYk8',
  mixFetchOverride: {
    requestTimeoutMs: 60_000
  },
  forceTls: true, // force WSS
  extra: {}
}
