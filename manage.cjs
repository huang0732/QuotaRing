'use strict';
if (process.platform === 'win32') {
  require('./windows/manage.cjs').main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else {
  console.error('QuotaRing 目前仅支持 Windows。');
  process.exitCode = 1;
}
