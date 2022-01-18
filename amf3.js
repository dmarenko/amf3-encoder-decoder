
const UNDEFINED_TYPE = 0x00
const NULL_TYPE = 0x01
const FALSE_TYPE = 0x02
const TRUE_TYPE = 0x03
const INTEGER_TYPE = 0x04
const DOUBLE_TYPE = 0x05
const STRING_TYPE = 0x06
// const XML_DOC_TYPE = 0x07
const DATE_TYPE = 0x08
const ARRAY_TYPE = 0x09
const OBJECT_TYPE = 0x0A
// const XML_TYPE = 0x0B
const BYTE_ARRAY_TYPE = 0x0C
// const VECTOR_INT_TYPE = 0x0D
// const VECTOR_UINT_TYPE = 0x0E
// const VECTOR_DOUBLE_TYPE = 0x0F
// const VECTOR_OBJECT_TYPE = 0x10
// const DICTIONARY_TYPE = 0x11

let buf, pos, strings, objects, traits

function reset() {
    buf = Buffer.alloc(4096)
    pos = 0
    strings = []
    objects = []
    traits = []
}

reset()

function encodeU29(number) {
    number &= 0x1fffffff // mask 29 lower bits
    if (number <= 0x7f) { // uses 7 bits
        buf[pos++] = number
    } else if (number <= 0x3fff) { // uses 14 bits
        buf[pos++] = (number >> 7) | 0x80
        buf[pos++] = number & 0x7f
    } else if (number <= 0x1fffff) { // uses 21 bits
        buf[pos++] = (number >> 14) | 0x80
        buf[pos++] = (number >> 7) | 0x80
        buf[pos++] = number & 0x7f
    } else if (number <= 0x1fffffff) { // 29 bits
        buf[pos++] = (number >> 22) | 0x80
        buf[pos++] = (number >> 15) | 0x80
        buf[pos++] = (number >> 8) | 0x80
        buf[pos++] = number & 0xff
    } else {
        throw new Error('U29 out of range')
    }
}

function decodeU29() {
    if ((buf[pos] & 0x80) == 0) {
        return buf[pos++]
    } else if ((buf[pos + 1] & 0x80) == 0) {
        return ((buf[pos++] & 0x7f) << 7) | buf[pos++]
    } else if ((buf[pos + 2] & 0x80) == 0) {
        return ((buf[pos++] & 0x7f) << 14) | ((buf[pos++] & 0x7f) << 7) | buf[pos++]
    }
    return ((buf[pos++] & 0x7f) << 22) | ((buf[pos++] & 0x7f) << 15) | ((buf[pos++] & 0x7f) << 8) | buf[pos++]
}

function decodeI29() {
    // let n = decodeU29()
    // if (n & 0x10000000) // check sign at 29th bit
    //     n -= 0x20000000
    return (decodeU29() << 3) >> 3
}

function encodeDouble(number) {
    pos += buf.writeDoubleLE(number, pos)
}

function decodeDouble() {
    const double = buf.readDoubleLE(pos)
    pos += 8
    return double
}

function encodeString(string) {
    const index = strings.indexOf(string)
    if (index !== -1) {
        encodeU29(index << 1)
        return
    }
    encodeU29((string.length << 1) | 1)
    pos += buf.write(string, pos)
    if (string !== '')
        strings.push(string)
}

function decodeString() {
    const header = decodeU29()
    if ((header & 1) == 0)
        return strings[header >> 1]
    const len = (header >> 1)
    const string = buf.slice(pos, pos + len).toString()
    pos += len
    if (string !== '')
        strings.push(string)
    return string
}

function encodeDate(date) {
    const index = objects.indexOf(date)
    if (index !== -1) {
        encodeU29(index << 1)
        return
    }
    objects.push(date)
    encodeU29(1)
    encodeDouble(date.getTime())
}

function decodeDate(date) {
    const header = decodeU29()
    if ((header & 1) == 0)
        return objects[header >> 1]
    const d = new Date(decodeDouble())
    objects.push(d)
    return d
}

function encodeByteArray(byteArray) {
    const index = objects.indexOf(byteArray)
    if (index !== -1) {
        encodeU29(index << 1)
        return
    }
    objects.push(byteArray)
    encodeU29((byteArray.length << 1) | 1)
    for (const byte of byteArray)
        buf[pos++] = byte
}

function decodeByteArray() {
    const header = decodeU29()
    if ((header & 1) == 0)
        return objects[header >> 1]
    const len = header >> 1
    const byteArray = new Uint8Array(len)
    objects.push(byteArray)
    for (let i = 0; i < len; i++)
        byteArray[i] = buf[pos++]
    return byteArray
}

function encodeArray(array) {
    const index = objects.indexOf(array)
    if (index !== -1) {
        encodeU29(index << 1)
        return
    }
    objects.push(array)
    encodeU29((array.length << 1) | 1)
    for (const key of Object.keys(array)) {
        const notIndice = !/^(0|[1-9][0-9]*)$/.test(key)
        if (notIndice) {
            encodeString(key)
            encode(array[key])
        }
    }
    encodeString('')
    for (let i = 0; i < array.length; i++) {
        encode(array[i])
    }
}

function decodeArray() {
    const header = decodeU29()
    if ((header & 1) == 0)
        return objects[header >> 1]
    const array = []
    objects.push(array)
    let key = decodeString()
    while (key != '') {
        array[key] = decode()
        key = decodeString()
    }
    const len = header >> 1
    for (let i = 0; i < len; i++)
        array.push(decode())
    return array
}

// Note: Empty string is considered a class alias and AS3's writeObject uses traits reference for anonymous classes
// For brevity anonymous classes will not share a traits object via reference
function encodeObject(object) {
    const index = objects.indexOf(object)
    if (index !== -1) {
        encodeU29(index << 1)
        return
    }
    objects.push(object)
    encodeU29(0x0B) // 0b1011: instance, no traits, not Externalizable
    encodeString('') // class name (anonymous)
    const keys = Object.keys(object)
    for (const key of keys) {
        encodeString(key)
        encode(object[key])
    }
    encodeString('') // terminate dynamic members
}

function decodeObject() {
    const header = decodeU29()
    if ((header & 1) == 0)
        return objects[header >> 1]
    let traitsObj
    if ((header & 2) == 0)
        traitsObj = traits[header >> 2]
    else {
        const externalizable = (header & 4) == 4    
        const dynamic = (header & 8) == 8
        const className = decodeString() // unused: registerClassAlias unsupported
        const memberCount = header >> 4
        const members = []
        for (let i = 0; i < memberCount; i++)
            members.push(decodeString())
        traitsObj = {
            members,
            externalizable,
            dynamic
        }
        traits.push(traitsObj)
    }
    const object = {}
    objects.push(object)
    if (traitsObj.externalizable)
        throw new Error('Unsupported externalizable class')
    for (const key of traitsObj.members)
        object[key] = decode()
    if (traitsObj.dynamic) {
        let key = decodeString()
        while (key != '') {
            object[key] = decode()
            key = decodeString()
        }
    }
    return object
}

// function registerClassAlias()

function encode(data) {
    if (data === undefined) {
        buf[pos++] = UNDEFINED_TYPE
    } else if (data === null) {
        buf[pos++] = NULL_TYPE
    } else if (data === false) {
        buf[pos++] = FALSE_TYPE
    } else if (data === true) {
        buf[pos++] = TRUE_TYPE
    } else if (typeof data === 'number') {
        if (Number.isInteger(data) && data < 0x10000000 && data >= -0x10000000) {
            buf[pos++] = INTEGER_TYPE
            encodeU29(data)
        } else {
            buf[pos++] = DOUBLE_TYPE
            encodeDouble(data)
        }
    } else if (typeof data === 'string') {
        buf[pos++] = STRING_TYPE
        encodeString(data)
    } else if (Array.isArray(data)) {
        buf[pos++] = ARRAY_TYPE
        encodeArray(data)
    } else if (data.constructor === Date) {
        buf[pos++] = DATE_TYPE
        encodeDate(data)
    } else if (data.constructor == Uint8Array) {
        buf[pos++] = BYTE_ARRAY_TYPE
        encodeByteArray(data)
    } else if (typeof data === 'object') {
        buf[pos++] = OBJECT_TYPE
        encodeObject(data)
    }
}

function decode() {
    const marker = buf[pos++]
    switch (marker) {
        case UNDEFINED_TYPE:
            return undefined
        case NULL_TYPE:
            return null
        case FALSE_TYPE:
            return false
        case TRUE_TYPE:
            return true
        case INTEGER_TYPE:
            return decodeI29()
        case DOUBLE_TYPE:
            return decodeDouble()
        case STRING_TYPE:
            return decodeString()
        case ARRAY_TYPE:
            return decodeArray()
        case DATE_TYPE:
            return decodeDate()
        case BYTE_ARRAY_TYPE:
            return decodeByteArray()
        case OBJECT_TYPE:
            return decodeObject()
        throw new Error('Unsupported type')
    }
}

exports.encodeAMF3 = function (object) {
    encode(object)
    const buffer = buf.slice(0, pos)
    reset()
    return buffer
}

exports.decodeAMF3 = function (buffer) {
    buf = buffer
    const object = decode()
    reset()
    return object
}