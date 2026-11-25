@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 24 or later is required. & exit /b 1)
if not exist node_modules\next\package.json (
  where pnpm >nul 2>nul || (echo Install pnpm from the project README. & exit /b 1)
  call pnpm install --frozen-lockfile || exit /b 1
)
node scripts\start.mjs

