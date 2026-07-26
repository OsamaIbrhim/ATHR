import { PrismaService } from './prisma.service'

type PrismaRuntime = {
  $connect: () => Promise<void>
  $disconnect: () => Promise<void>
  $queryRawUnsafe: (
    query: string,
    ...values: unknown[]
  ) => Promise<unknown>
}

describe('PrismaService pool warm-up', () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
    jest.restoreAllMocks()
  })

  it('warms the configured bounded pool without blocking server startup', async () => {
    process.env.DATABASE_URL =
      'postgresql://user:pass@localhost:5432/bold?connection_limit=3&pool_timeout=10&connect_timeout=15'
    process.env.DIRECT_URL =
      'postgresql://user:pass@localhost:5432/bold?connect_timeout=30'
    process.env.DB_POOL_WARM_CONNECTIONS = '3'

    const service = new PrismaService()

    const connect = jest.fn(
      async (): Promise<void> => undefined,
    )

    const disconnect = jest.fn(
      async (): Promise<void> => undefined,
    )

    const query = jest.fn(
      async (
        _query: string,
        ..._values: unknown[]
      ): Promise<unknown> => [{ value: 1 }],
    )

    const prisma = service as unknown as PrismaRuntime

    Object.defineProperties(prisma, {
      $connect: {
        configurable: true,
        value: connect,
      },
      $disconnect: {
        configurable: true,
        value: disconnect,
      },
      $queryRawUnsafe: {
        configurable: true,
        value: query,
      },
    })

    const startupResult = service.onModuleInit()

    expect(startupResult).toBeUndefined()

    // initializeDatabase runs asynchronously in the background.
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(connect).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(3)

    for (const call of query.mock.calls) {
      expect(call).toEqual(['SELECT 1::integer AS value'])
    }

    await service.onApplicationShutdown()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})