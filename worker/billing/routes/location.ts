/** Branch / warehouse for this request (validated against the business; never a made-up id). */
export async function locate(c: any, wanted: { branchId?: string | null; warehouseId?: string | null } = {}) {
  const stub = c.get('businessStub');
  return (await stub.resolveLocation({
    branchId: wanted.branchId || c.req.header('X-Branch-Id') || c.req.query('branchId') || null,
    warehouseId: wanted.warehouseId || c.req.header('X-Warehouse-Id') || null,
  })) as { branchId: string; warehouseId: string | null };
}
