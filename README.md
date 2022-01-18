# amf3-encoder-decoder

Lightweight implementation for encoding and decoding AMF3 for NodeJS.

Spec: [https://www.adobe.com/content/dam/acom/en/devnet/pdf/amf-file-format-spec.pdf](https://www.adobe.com/content/dam/acom/en/devnet/pdf/amf-file-format-spec.pdf)

## Example

```javascript
const { encodeAMF3, decodeAMF3 } = require('./amf3')

const numbers = [12, 13, 14, 15]

const example = {
	abc: 'hello',
	xyz: 'world',
	numbers,
	qwerty: {
		arr: [10, 20, 30, numbers]
	}
}

const buf = encodeAMF3(example)
const decoded = decodeAMF3(buf)

console.log(example)
console.log(decoded)

```
