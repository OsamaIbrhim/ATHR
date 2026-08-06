import { IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class CreateUomConversionDto {
  @IsUUID()
  from_uom_id: string;

  @IsUUID()
  to_uom_id: string;

  // BR-UOM-102: conversion factor is always positive.
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  factor: number;
}

export class SupersedeUomConversionDto {
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  factor: number;
}

export class ListUomConversionsDto {
  @IsOptional()
  @IsUUID()
  from_uom_id?: string;

  @IsOptional()
  @IsUUID()
  to_uom_id?: string;
}
