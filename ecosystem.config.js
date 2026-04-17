module.exports = {
  apps: [
    {
      name: 'smcorse-api',
      script: 'server.js',
      cwd: 'C:\\Users\\maxim\\Documents\\smcorse',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true
    },
    {
      name: 'smcorse-frontend',
      script: 'node',
      args: 'node_modules/next/dist/bin/next start -p 3001',
      cwd: 'C:\\Users\\maxim\\Documents\\smcorse\\frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      error_file: '../logs/frontend-err.log',
      out_file: '../logs/frontend-out.log',
      log_file: '../logs/frontend-combined.log',
      time: true
    }
  ]
};
