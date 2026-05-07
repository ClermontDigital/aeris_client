// Silent logger mock. The real electron-log writes to disk; in jest we
// just want noop functions so tests don't pollute ~/Library/Logs/.

const noop = () => undefined;

const log = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  transports: {
    file: { level: 'info' },
    console: { level: 'debug' },
  },
};

export default log;
