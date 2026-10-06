-- W3: transfer numbers move to the per-tenant DocumentSequence (key 'transfer', prefix TR-).
-- The global sequence showed one tenant how many transfers every other tenant had made.
DROP SEQUENCE "TransferNumberSequence";
