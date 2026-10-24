/** Module boundary + Clean Architecture layer rules (docs/backend/README.md §2.3). Run: npm run boundaries */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internals',
      comment: "A module may import only another module's public-api/.",
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/public-api/'] },
    },
    {
      name: 'domain-is-pure',
      comment: 'domain/ has no I/O: no express, drizzle, pg, redis, bullmq, infrastructure or presentation.',
      severity: 'error',
      from: { path: '/domain/' },
      to: {
        path: ['node_modules/(express|drizzle-orm|pg|ioredis|bullmq)/', '/infrastructure/', '/presentation/', '/http/'],
      },
    },
    {
      name: 'application-no-infrastructure-or-http',
      severity: 'error',
      from: { path: '^src/(modules/[^/]+|shared)/application/' },
      to: { path: ['/presentation/', '/infrastructure/', '^src/shared/http/', 'node_modules/express/'] },
    },
    {
      name: 'presentation-no-infrastructure',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/presentation/' },
      to: { path: '^src/modules/[^/]+/infrastructure/' },
    },
    {
      name: 'shared-does-not-know-modules',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },
    { name: 'no-circular', severity: 'warn', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
