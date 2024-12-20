# Stable Interview Project

## Branches:

1. main: 

Here, I tried using using `permissionless` (used in Pimlico's example) to send my `UserOperation`

2. deploy-simple-account: 

Here, I used the `@account-abstraction-sdk` package to send my `UserOperation`

## Status:

In both branches, my transaction is being reverted, and I am not sure why. I was very careful to ensure each account was properly funded, and I am using a very simple transaction that should go through. 

My script is in src/deploySimpleAccount.ts. At the bottom of the file in each branch, look at the bottom of the file for the error message.

## Setup:

```
yarn install
```

In the .env file:

```
MNEMONIC_FILE=<path to your mnemonic phrase file, such as mnemonic.txt>
INFURA_ID=<your infura project id, if you are using infura. Otherwise, make changes to hardhat.config.ts>
SIMPLE_ACCOUNT_FACTORY_ADDRESS=<optional, address of the simple account factory, if you wish to use a pre-deployed one>
PIMLICO_API_KEY=<your pimlico api key>
DEPLOY_ENTRYPOINT=<if you want to deploy the entrypoint and not use the pre-deployed one, set to true, otherwise set to false (default)>
```

Run the deploy and transact script:

```
npx hardhat run src/deploySimpleAccount.ts --network sepolia (or another network of your choice)
``` 
