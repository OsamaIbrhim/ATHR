import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { EGYPTIAN_MOBILE_PATTERN } from '../users/dto/create-user.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SignupDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  tenant_name: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  owner_name: string;

  /** Login is by phone, so it is required. */
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value))
  @IsString()
  @Matches(EGYPTIAN_MOBILE_PATTERN, { message: 'phone must be a valid Egyptian mobile number' })
  phone: string;

  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  email?: string;

  // bcrypt only uses the first 72 bytes.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  /** A lowercase slug (e.g. `fashion`), kept to pick a catalog preset later. */
  @IsOptional()
  @Transform(trim)
  @Matches(/^[a-z][a-z0-9_-]{1,39}$/, { message: 'business_type must be a lowercase slug of 2-40 characters' })
  business_type?: string;
}
