import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomerAccountsController } from './customer-accounts.controller';
import { CustomerAccountsService } from './customer-accounts.service';

@Module({
  providers: [CustomersService, CustomersRepository, CustomerAccountsService],
  // CustomerAccountsController first: `customers/debtors` must win over `customers/:id`.
  controllers: [CustomerAccountsController, CustomersController],
  exports: [CustomersService, CustomersRepository, CustomerAccountsService],
})
export class CustomersModule {}
