const pkg = require('../package.json')
const dashify = require('dashify')
const fetch = require('node-fetch')
const crypto = require('crypto')
const fs = require('fs')

const {
  PACKAGE_NAME = pkg.name,
  PACKAGE_VERSION = pkg.version,
  KEYGEN_ACCOUNT_ID,
  KEYGEN_PRODUCT_ID,
  KEYGEN_PRODUCT_TOKEN,
} = process.env

if (!KEYGEN_ACCOUNT_ID) {
  console.error('env var KEYGEN_ACCOUNT_ID is required')

  process.exit(1)
}

if (!KEYGEN_PRODUCT_ID) {
  console.error('env var KEYGEN_PRODUCT_ID is required')

  process.exit(1)
}

if (!KEYGEN_PRODUCT_TOKEN) {
  console.error('env var KEYGEN_PRODUCT_TOKEN is required')

  process.exit(1)
}

async function createRelease() {
  const res = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/releases`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      'Keygen-Version': '1.1',
    },
    body: JSON.stringify({
      data: {
        type: 'release',
        attributes: {
          version: PACKAGE_VERSION,
          channel: 'stable',
        },
        relationships: {
          product: {
            data: { type: 'product', id: KEYGEN_PRODUCT_ID }
          }
        }
      }
    })
  })

  const { data, errors } = await res.json()
  if (errors) {
    throw new Error(`failed to create release for product ${KEYGEN_PRODUCT_ID}: ${JSON.stringify({ errors })}`)
  }

  return data
}

async function publishRelease(release) {
  const res = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/releases/${release.id}/actions/publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'Accept': 'application/vnd.api+json',
      'Keygen-Version': '1.1',
    },
  })

  const { data, errors } = await res.json()
  if (errors) {
    throw new Error(`failed to publish release ${release.id}: ${JSON.stringify({ errors })}`)
  }

  return data
}

function getTarballPathForPackage() {
  return `dist/${dashify(PACKAGE_NAME)}-${PACKAGE_VERSION}.tgz`
}

async function getChecksumForFile(path) {
  return new Promise(resolve => {
    const shasum = crypto.createHash('sha512')
    const stream = fs.createReadStream(path)

    stream.on('data', d => shasum.update(d))
    stream.on('end', () => resolve(shasum.digest('base64')))
  })
}

async function uploadArtifactForRelease({ releaseId, type, file, checksum, filename, filetype, filesize }) {
  const res = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/artifacts`, {
    redirect: 'manual',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      'Keygen-Version': '1.1',
    },
    body: JSON.stringify({
    data: {
        type: 'artifact',
        attributes: {
          platform: 'npm',
          checksum,
          filename,
          filetype,
          filesize,
        },
        relationships: {
          release: {
            data: { type: 'release', id: releaseId }
          }
        }
      }
    }),
  })

  const { data, errors } = await res.json()
  if (errors) {
    throw new Error(`failed to create artifact for release ${releaseId}: ${JSON.stringify({ errors })}`)
  }

  // Upload to S3
  const url = res.headers.get('location')
  const s3 = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Length': filesize,
      'Content-Type': type,
    },
    body: file,
  })

  if (s3.status !== 200) {
    throw new Error(`failed to upload artifact to ${url}: ${s3.status}`)
  }

  return data
}

async function publishTarballForPackage(release) {
  const path = getTarballPathForPackage()
  const checksum = await getChecksumForFile(path)
  const stat = fs.statSync(path)
  const filesize = stat.size
  const filename = `${PACKAGE_NAME}/${PACKAGE_VERSION}.tgz`
  const filetype = 'tgz'

  const artifact = await uploadArtifactForRelease({
    releaseId: release.id,
    type: 'application/tar+gzip',
    file: fs.createReadStream(path),
    checksum,
    filename,
    filetype,
    filesize,
  })

  return {
    artifact,
    release,
  }
}

async function getManifestForPackage() {
  const res = await fetch(`https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/artifacts/${PACKAGE_NAME}`, {
    redirect: 'manual',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${KEYGEN_PRODUCT_TOKEN}`,
      'Accept': 'application/json',
      'Keygen-Version': '1.1',
    }
  })

  // Manifest hasn't been uploaded yet
  if (res.status === 404) {
    return null
  }

  const { errors } = await res.json()
  if (errors) {
    throw new Error(`failed to retrieve manifest for ${PACKAGE_NAME}: ${JSON.stringify({ errors })}`)
  }

  // Fetch from S3
  const url = res.headers.get('location')
  const s3 = await fetch(url)

  if (s3.status !== 200) {
    throw new Error(`failed to retrieve manifest from ${url}: ${s3.status}`)
  }

  return s3.json()
}

async function publishManifestForPackage(release) {
  const path = getTarballPathForPackage(PACKAGE_NAME, PACKAGE_VERSION)
  const checksum = await getChecksumForFile(path)

  // Attempt to merge previous manifest's versions to ensure we maintain history
  const prev = await getManifestForPackage(PACKAGE_NAME)
  const next = {
    _id: PACKAGE_NAME,
    name: PACKAGE_NAME,
    'dist-tags': {
      latest: PACKAGE_VERSION,
    },
    versions: Object.assign({}, prev?.versions, {
      [PACKAGE_VERSION]: {
        ...pkg,
        _id: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
        dist: {
          tarball: `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT_ID}/artifacts/${PACKAGE_NAME}/${PACKAGE_VERSION}.tgz`,
          integrity: `sha512-${checksum}`,
        }
      },
    })
  }

  const manifest = Buffer.from(JSON.stringify(next))
  const filename = PACKAGE_NAME
  const filesize = manifest.byteLength
  const filetype = 'json'

  const artifact = await uploadArtifactForRelease({
    releaseId: release.id,
    type: 'application/json',
    file: manifest,
    filename,
    filetype,
    filesize,
  })

  return {
    artifact,
    release,
  }
}

async function main() {
  const release = await createRelease()

  await publishTarballForPackage(release)
  await publishManifestForPackage(release)
  await publishRelease(release)
}

main()
