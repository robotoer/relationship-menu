import { calculateIpfsHash } from './ipfs';

describe('calculateIpfsHash', () => {
  it('should return the correct IPFS hash for a given input', () => {
    const input = 'Hello, IPFS!';
    const expectedHash = 'Qm...'; // Replace with the actual expected hash
    const result = calculateIpfsHash(input);
    expect(result).toBe(expectedHash);
  });
});
