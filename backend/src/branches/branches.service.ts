import { Injectable, InternalServerErrorException, ConflictException, Logger } from '@nestjs/common';
import { CreateBranchDto } from './dto/create-branch.dto';
import { BranchesRepository } from './branches.repository';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(private readonly repository: BranchesRepository) {}

  async findAll(context: TenantContext) {
    try {
      return await this.repository.list(context);
    } catch (error) {
      this.logger.error('Failed to fetch branches', error instanceof Error ? error.stack : error);
      throw new InternalServerErrorException('Failed to fetch branches');
    }
  }

  async create(context: TenantContext, data: CreateBranchDto) {
    try {
      return await this.repository.save(context, data);
    } catch (error: any) {
      this.logger.error('Failed to create branch', error instanceof Error ? error.stack : error);

      if (error?.code === 'P2002') {
        throw new ConflictException('A branch with this ID already exists');
      }

      throw new InternalServerErrorException('Failed to create branch');
    }
  }
}
