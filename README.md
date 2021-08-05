# Publishing a private npm module to Keygen

See blog post: https://keygen.sh/blog/how-to-license-and-distribute-commercial-node-modules/

## Configuration

First up, configure a couple environment variables. The values below are for our `demo`
account, which can be used in this example.

```bash
# Your Keygen product API token
export KEYGEN_PRODUCT_TOKEN="prod-xxx"

# Your Keygen account ID
export KEYGEN_ACCOUNT_ID="1fddcec8-8dd3-4d8d-9b16-215cac0f9b52"

# Your Keygen product ID
export KEYGEN_PRODUCT_ID="028e670a-9cc7-4dd2-af9e-78af5ccaf27f"
```

These environment variables will be used for creating new releases and uploading artifacts
to the distribution API. All releases created will be for `KEYGEN_PRODUCT_ID`.

## Publishing the module

To package and publish the module to Keygen, run the `publish` script:

```bash
npm run publish
```

This will perform [the following](https://github.com/keygen-sh/example-private-npm-package/blob/master/package.json),
using the `version` set in `package.json`:

1. Package the module into a tarball using `npm pack`
1. Upload the tarball artifact to Keygen
1. Update the npm manifest artifact

## Using the registry

To use Keygen as a private npm registry, we'll need to configure npm to retrieve modules
under the `@demo` scope from Keygen: (note double quotes)

```bash
npm config set @demo:registry "https://api.keygen.sh/v1/accounts/$KEYGEN_ACCOUNT_ID/artifacts/"
npm config set "//api.keygen.sh/v1/accounts/$KEYGEN_ACCOUNT_ID/artifacts/:_authToken" "$KEYGEN_PRODUCT_TOKEN"
```

#### In CI/CD envs

If you'd rather not store your token in your global `.npmrc`, you can also tell npm to
pull the token from an env variable. For example, this would pull the token from a
`KEYGEN_TOKEN` env var: (note single quotes)

```bash
npm config set @demo:registry 'https://api.keygen.sh/v1/accounts/demo/artifacts/'
npm config set '//api.keygen.sh/v1/accounts/demo/artifacts/:_authToken=${KEYGEN_TOKEN}'
```

#### Project-specific `.npmrc`

Use a project-specific `.npmrc` file with a variable for your token to securely authenticate
your CI/CD server. Project-specific `.npmrc` files can be safely checked into version control,
since the token is not hard coded:

```
@demo:registry=https://api.keygen.sh/v1/accounts/demo/artifacts/
//api.keygen.sh/v1/accounts/demo/artifacts/:_authToken=${KEYGEN_TOKEN}
```

## Installing the module

Next, we can install the module, which npm should retrieve from Keygen:

```
npm install -g @demo/hello-world
```
