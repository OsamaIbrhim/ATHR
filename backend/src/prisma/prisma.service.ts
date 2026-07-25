import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { configureDatabaseConnection } from '../config/database-connection'

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name)
  private readonly warmConnections: number

  constructor() {
    const configuration = configureDatabaseConnection()

    super({
      datasources: {
        db: { url: configuration.databaseUrl },
      },
    })

    this.warmConnections = configuration.warmConnections
  }

  onModuleInit(): void {
    // Database startup must not block the HTTP server healthcheck.
    void this.initializeDatabase()
  }

  private async initializeDatabase(): Promise<void> {
    try {
      await this.$connect()

      this.logger.log(
        JSON.stringify({
          level: 'info',
          errorCode: null,
          component: 'database',
          status: 'connected',
          message: 'Database connection established successfully',
        }),
      )

      await Promise.all(
        Array.from({ length: this.warmConnections }, () =>
          this.$queryRawUnsafe('SELECT 1::integer AS value'),
        ),
      )

      this.logger.log(
        JSON.stringify({
          level: 'info',
          errorCode: null,
          component: 'database',
          status: 'ready',
          warmConnections: this.warmConnections,
          message: 'Database connection pool warmed successfully',
        }),
      )
    } catch (error: unknown) {
      const normalizedError = this.normalizeDatabaseError(error)

      this.logger.error(
        JSON.stringify({
          level: 'error',
          errorCode: normalizedError.errorCode,
          component: 'database',
          status: 'unavailable',
          message: normalizedError.message,
          originalCode: normalizedError.originalCode,
        }),
        error instanceof Error ? error.stack : undefined,
      )
    }
  }

  private normalizeDatabaseError(error: unknown): {
    errorCode: string
    originalCode: string | null
    message: string
  } {
    const originalCode =
      typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
        ? error.code
        : null

    const originalMessage =
      error instanceof Error ? error.message : 'Unknown database error'

    if (
      originalCode === 'P1001' ||
      originalMessage.toLowerCase().includes('connect') ||
      originalMessage.toLowerCase().includes('timeout')
    ) {
      return {
        errorCode: 'DATABASE_CONNECTION_FAILED',
        originalCode,
        message:
          'The server started, but it could not connect to the database. Check DATABASE_URL, Supabase availability, network access, and connection limits.',
      }
    }

    if (originalCode === 'P1000') {
      return {
        errorCode: 'DATABASE_AUTHENTICATION_FAILED',
        originalCode,
        message:
          'The database rejected the credentials. Check the database username, password, and connection URL.',
      }
    }

    if (originalCode === 'P1003') {
      return {
        errorCode: 'DATABASE_NOT_FOUND',
        originalCode,
        message:
          'The configured database does not exist or cannot be accessed.',
      }
    }

    if (
      originalCode === 'P2024' ||
      originalMessage.toLowerCase().includes('connection pool')
    ) {
      return {
        errorCode: 'DATABASE_POOL_EXHAUSTED',
        originalCode,
        message:
          'The database connection pool is exhausted. Check connection_limit, DB_POOL_WARM_CONNECTIONS, and active deployments.',
      }
    }

    return {
      errorCode: 'DATABASE_INITIALIZATION_FAILED',
      originalCode,
      message: `Database initialization failed: ${originalMessage}`,
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.$disconnect()

      this.logger.log(
        JSON.stringify({
          level: 'info',
          errorCode: null,
          component: 'database',
          status: 'disconnected',
          message: 'Database disconnected successfully',
        }),
      )
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown disconnect error'

      this.logger.error(
        JSON.stringify({
          level: 'error',
          errorCode: 'DATABASE_DISCONNECT_FAILED',
          component: 'database',
          status: 'error',
          message,
        }),
        error instanceof Error ? error.stack : undefined,
      )
    }
  }
}