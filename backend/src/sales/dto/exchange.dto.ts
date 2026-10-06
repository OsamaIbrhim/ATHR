import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { CreateReturnDto } from './create-return.dto';
import { CreateSaleDto } from './create-sale.dto';

/**
 * An exchange: goods come back (the return part, same fields as a return) and
 * new goods are sold (`sale`, the same command a till sends for any sale, with
 * its own payments), in one transaction.
 */
export class ExchangeDto extends CreateReturnDto {
  @ValidateNested()
  @Type(() => CreateSaleDto)
  sale: CreateSaleDto;
}
