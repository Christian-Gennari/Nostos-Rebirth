module.exports = {
  apps: [{
    name: 'nostos',
    script: 'npm',
    args: 'run prod',
    cwd: '/home/dev/projects/nostos-rebirth',
    env: {
      ASPNETCORE_ENVIRONMENT: 'Production',
      ASPNETCORE_URLS: 'http://0.0.0.0:5214',
      version: ''
    }
  }]
}