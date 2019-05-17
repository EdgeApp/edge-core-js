// @flow

let status = 'loaded'

/**
 * Change the status message visible in the debug area.
 */
export function changeStatus(newStatus: string): mixed {
  status = newStatus
}

/**
 * Display a status line / heartbeat in debug mode.
 */
export function showStatus() {
  // Capture script-level errors and display them:
  let errorStatus = ''
  window.onerror = function(message, source, line, column, error) {
    errorStatus = `${source}:${line}:${column} ${message}`
  }

  const body = document.body
  if (body == null) return

  const div = document.createElement('div')
  body.appendChild(div)
  body.style.background = '#444'
  body.style.color = '#fff'
  body.style.margin = '0'
  body.style.padding = '0'

  let step = 0
  function updateStatus() {
    const steps = ['⠇', '⠋', '⠙', '⠸', '⠴', '⠦']
    step = (step + 1) % steps.length
    div.innerHTML = `${steps[step]} ${status} ${errorStatus}`
    setTimeout(updateStatus, 100)
  }
  updateStatus()
}
