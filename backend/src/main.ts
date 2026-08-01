import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-error.filter';
import { RequestContextMiddleware } from './common/http/request-context.middleware';
import { ResponseEnvelopeInterceptor } from './common/http/response-envelope.interceptor';
import compression from 'compression';
import { apiJsonReplacer } from './common/json-serialization';
import { validateRuntimeEnvironment } from './config/environment';
import { configureDatabaseConnection } from './config/database-connection';

async function bootstrap() {
  // Bound and normalize the Prisma pool before PrismaClient reads DATABASE_URL.
  configureDatabaseConnection();
  // Validate every security-critical setting before Nest constructs providers or
  // opens a database connection. Configuration errors must fail the deployment.
  const environment = validateRuntimeEnvironment();
  const app = await NestFactory.create(AppModule);
  // Keep BigInt handling inside the HTTP adapter. Sync cursors are explicitly
  // strings, while this protects future database counters from causing a 500.
  app.getHttpAdapter().getInstance().set('json replacer', apiJsonReplacer);
  app.setGlobalPrefix('api/v1');
  app.use(compression({ threshold: 1024 }));
  // Formalizes the previous inline request-id middleware into a reusable
  // class (identical request-id behavior — same validation pattern, same
  // req.requestStartedAt/req.requestId fields PerformanceInterceptor and
  // ApiExceptionFilter already read) and additionally issues X-Correlation-Id
  // on every request, per API Contract v1.0 §6.
  app.use(new RequestContextMiddleware().use);
  // ApiExceptionFilter stays the sole *global* exception filter: NestJS only
  // invokes the first catch-all filter that matches a given exception, so a
  // second global catch-all (AthrExceptionFilter) would either never run
  // (registered after) or silently replace this one's output on every
  // not-yet-migrated route (registered before) — neither is additive. See
  // docs/architecture/api-error-contract-foundation.md for the full
  // reconciliation. AthrExceptionFilter is instead applied per-route via
  // `@UseFilters(AthrExceptionFilter)`, which NestJS resolves before falling
  // back to this global filter, on the two WP-003 proof-of-concept routes.
  app.useGlobalFilters(new ApiExceptionFilter());
  // Additive: composes alongside PerformanceInterceptor (registered via
  // APP_INTERCEPTOR in app.module.ts). Unlike exception filters, NestJS
  // interceptors chain rather than short-circuit, so this is safe to add
  // globally — it only transforms responses from handlers that opt in via
  // `@Envelope(...)`; every other route's response is untouched.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  app.enableCors({ origin: environment.corsOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const config = new DocumentBuilder()
    .setTitle('ATHR Operations API')
    .setDescription('Multi-branch POS + Inventory – EGP, ar-EG')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(environment.port, '0.0.0.0');
  console.log(
    JSON.stringify({
      level: 'info',
      errorCode: null,
      component: 'server',
      status: 'running',
      port: environment.port,
      message: `ATHR API is running on port ${environment.port}`,
    }),
  )
}
bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown server startup failure'

  console.error(
    JSON.stringify({
      level: 'fatal',
      errorCode: 'SERVER_STARTUP_FAILED',
      component: 'server',
      status: 'crashed',
      message,
      stack: error instanceof Error ? error.stack : undefined,
    }),
  )

  process.exit(1)
})
