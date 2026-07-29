function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`)
  }
  return value
}

export function requireCatalogV2ProductMap(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.products)) {
    throw new Error('Catalog snapshot must contain a products array')
  }

  const products = new Map()
  snapshot.products.forEach((product, index) => {
    if (!product || typeof product !== 'object') {
      throw new Error(`Catalog product ${index} must be an object`)
    }
    if (product.catalog_version !== 2) {
      throw new Error(`Catalog product ${index} must use catalog version 2`)
    }

    const id = requireNonEmptyString(product.id, `Catalog product ${index} ID`)
    requireNonEmptyString(product.sku, `Catalog product ${id} SKU`)
    if (
      (typeof product.name_ar !== 'string' || product.name_ar.trim().length === 0) &&
      (typeof product.name_en !== 'string' || product.name_en.trim().length === 0)
    ) {
      throw new Error(
        `Catalog product ${id} must have an Arabic or English name`,
      )
    }
    requireFiniteNumber(product.selling_price, `Catalog product ${id} selling price`)
    requireFiniteNumber(product.unit_tax, `Catalog product ${id} unit tax`)

    if (products.has(id)) {
      throw new Error(`Catalog snapshot contains duplicate variant ${id}`)
    }
    products.set(id, product)
  })

  if (products.size === 0) {
    throw new Error('Catalog snapshot does not contain any sellable variants')
  }
  return products
}
