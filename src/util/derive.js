export { makeComputed as derive }

// Triggers an initial value calculation by always appearing dirty:
const DIRTY_SOURCES = { x: { get () {}, value: null } }

let currentSink = null
let epoch = 0
let nextId = 0

function makeId (type) {
  return type + nextId++
}

/**
 * Returns true if a computed value or reaction is fresh.
 */
function isSinkFresh (sink) {
  const lastSink = currentSink
  currentSink = null
  try {
    for (const id in sink.sources) {
      const info = sink.sources[id]
      if (info.value !== info.get()) {
        return false
      }
    }
    return true
  } finally {
    currentSink = lastSink
  }
}

/**
 * Runs a reaction.
 */
function runReaction (reaction, invoke) {
  const { f, stores } = reaction

  // Run the reaction:
  const lastSink = currentSink
  currentSink = reaction
  try {
    reaction.sources = {}
    reaction.stores = {}
    invoke(f)
  } finally {
    currentSink = lastSink
  }

  // Add new store registrations:
  for (const id in reaction.stores) {
    const info = reaction.stores[id]
    info[reaction.id] = reaction
  }

  // Remove old store registrations:
  for (const id in stores) {
    if (reaction.stores[id] == null) {
      const info = stores[id]
      delete info[reaction.id]
    }
  }
}

/**
 * Creates a value store.
 * Changing the store contents will automatically invalidate any downstream
 * computed values and trigger any downstream actions.
 */
export function makeStore (value, invoke = f => f()) {
  const store = {
    id: makeId('s'),
    invoke,
    reactions: {},
    value
  }

  const get = function get () {
    // If any sinks are currently evaluating, add ourselves as a source:
    if (currentSink != null) {
      const { id, value, reactions } = store
      // If a reaction does an update, it might read two versions of the
      // same source. Only write our value if it hasn't been read already:
      if (currentSink.sources[id] !== null) {
        currentSink.sources[id] = { get, value }
      }
      currentSink.stores[id] = reactions
    }

    return store.value
  }

  get.set = function set (value) {
    if (value !== store.value) {
      store.value = value
      ++epoch

      // Run any reactions that depend on us:
      for (const id in store.reactions) {
        const reaction = store.reactions[id]
        if (!isSinkFresh(reaction)) {
          runReaction(reaction, store.invoke)
        }
      }
    }
  }

  return get
}

/**
 * Memoizes the provided function, not over its formal parameters,
 * but over the stores and computed values it accesses.
 */
export function makeComputed (f) {
  const computed = {
    epoch: -1,
    f,
    id: makeId('c'),
    sources: DIRTY_SOURCES,
    stores: {}
  }

  const get = function get () {
    // If we are stale, re-compute our value:
    if (computed.epoch !== epoch && !isSinkFresh(computed)) {
      const lastSink = currentSink
      currentSink = computed
      try {
        computed.sources = {}
        computed.stores = {}
        computed.value = f()
      } finally {
        currentSink = lastSink
      }
    }
    computed.epoch = epoch

    // If any sinks are currently evaluating, add ourselves as a source:
    if (currentSink != null) {
      const { id, value, stores } = computed
      // If a reaction does an update, it might read two versions of the
      // same source. Only write our value if it hasn't been read already:
      if (currentSink.sources[id] !== null) {
        currentSink.sources[id] = { get, value }
      }
      for (const id in stores) {
        const info = stores[id]
        currentSink.stores[id] = info
      }
    }

    return computed.value
  }

  return get
}

/**
 * Runs the provided block of code each time an observed value changes.
 */
export function makeReaction (f) {
  const reaction = {
    f,
    id: makeId('r'),
    sources: {},
    stores: {}
  }

  const disposer = function disposer () {
    for (const id in reaction.stores) {
      const info = reaction.stores[id]
      delete info[reaction.id]
    }
  }

  runReaction(reaction, f => (disposer.result = f()))

  return disposer
}
