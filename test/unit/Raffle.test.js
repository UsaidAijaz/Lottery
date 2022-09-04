const { assert, expect } = require("chai")
const { network, getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Uint Test", async function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
          const chainId = network.config.chainId
          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })

          describe("constructor", async function () {
              it("Initializes the raffle correctly", async function () {
                  const raffleState = await raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["keepersUpdateInterval"])
              })
          })
          describe("EnterRaffle", async function () {
              it("Reverts when you don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__SendMoreToEnterRaffle"
                  )
              })
              it("records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits an event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })
              it("doesn't allow entrance when raffle is calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) // we want to get raffle to closed state , we perform upkeep but perform upkeep can only be called if checkupkeep returns true (here we increased the time)
                  await network.provider.send("evm_mine", []) // now we mined the block
                  //we pretend to be a chainlink keeper
                  await raffle.performUpkeep([])
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__RaffleNotOpen"
                  )
              })
          })
          describe("checkUpKeep", async function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]) // if we call  raffle.checkupkeep it will start a transaction as it is a public function not view function, so we want to simulate the transaction
                  assert(!upkeepNeeded)
              })
              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([])
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })
          })
          describe("performUpkeep", async function () {
              it("it can only run if checkupkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  //making checkupkeep to return true
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])

                  const tx = await raffle.performUpkeep([])
                  assert(tx)
              })
              it("Reverts when checkupkeep is false", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              it("updates the raffle state, emits and event and calls teh vrf coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const raffleState = await raffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert(raffleState.toString() == "1")
              })
          })
          describe("fulfillRandomWords", async function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              contract("Raffle", function (accounts) {
                  // All the assertions are done once the WinnerPicked event is fired
                  it("picks a winner, resets, and sends money", async () => {
                      const additionalEntrances = 3 // to test
                      const startingIndex = 2
                      for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
                          // i = 2; i < 5; i=i+1
                          raffle = raffleContract.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                          await raffle.enterRaffle({ value: raffleEntranceFee })
                      }
                      const startingTimeStamp = await raffle.getLastTimeStamp() // stores starting timestamp (before we fire our event)

                      // This will be more important for our staging tests...
                      await new Promise(async (resolve, reject) => {
                          raffle.once("WinnerPicked", async () => {
                              // event listener for WinnerPicked
                              console.log("WinnerPicked event fired!")
                              // assert throws an error if it fails, so we need to wrap
                              // it in a try/catch so that the promise returns event
                              // if it fails.
                              try {
                                  // Now lets get the ending values...
                                  const recentWinner = await raffle.getRecentWinner()
                                  const raffleState = await raffle.getRaffleState()
                                  const winnerBalance = await accounts[2].getBalance()
                                  const endingTimeStamp = await raffle.getLastTimeStamp()
                                  await expect(raffle.getPlayer(0)).to.be.reverted
                                  // Comparisons to check if our ending values are correct:
                                  assert.equal(recentWinner.toString(), accounts[2].address)
                                  assert.equal(raffleState, 0)
                                  assert.equal(
                                      winnerBalance.toString(),
                                      startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                          .add(
                                              raffleEntranceFee
                                                  .mul(additionalEntrances)
                                                  .add(raffleEntranceFee)
                                          )
                                          .toString()
                                  )
                                  assert(endingTimeStamp > startingTimeStamp)
                                  resolve() // if try passes, resolves the promise
                              } catch (e) {
                                  reject(e) // if try fails, rejects the promise
                              }
                          })

                          // kicking off the event by mocking the chainlink keepers and vrf coordinator
                          const tx = await raffle.performUpkeep("0x")
                          const txReceipt = await tx.wait(1)
                          const startingBalance = await accounts[2].getBalance()
                          await vrfCoordinatorV2Mock.fulfillRandomWords(
                              txReceipt.events[1].args.requestId,
                              raffle.address
                          )
                      })
                  })
              })
          })
      })
