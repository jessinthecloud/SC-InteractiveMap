/* global Intl, self, Promise */
import pako                                     from '../Lib/pako.esm.js';

import Building_Conveyor                        from '../Building/Conveyor.js';

export default class SaveParser_Write
{
    constructor(worker, options)
    {
        this.worker                 = worker;
        this.worker.messageIds      = 0;
        this.worker.callbacks       = [];
        this.worker.saveParserWrite = this;

        this.header                 = options.header;
        this.maxChunkSize           = options.maxChunkSize;
        this.PACKAGE_FILE_TAG       = options.PACKAGE_FILE_TAG;

        this.levels                 = options.levels;
        this.availableLevels        = options.availableLevels;

        this.stepsLength            = 5000;
        this.saveBinaryReplacer     = [];
        this.saveBinaryValues       = {};
        this.countObjects           = options.countObjects;

        this.gameStatePathName      = options.gameStatePathName;
        this.playerHostPathName     = options.playerHostPathName;

        this.language               = options.language;

        // Used for writing...
        this.currentBufferLength    = 0;
        this.currentEntityLength    = 0;

        return this.streamSave();
    }

    handleWorkerMessage(data)
    {
        let callback = this.worker.callbacks[data.messageId];
            if(!callback){ return; }

        delete this.worker.callbacks[data.messageId];
        delete data.messageId;
        return callback(data.data);
    }
    postWorkerMessage(data)
    {
        data.messageId = this.worker.messageIds++;

        return new Promise((resolve) => {
            this.worker.callbacks[data.messageId] = function(data){
                return resolve(data);
            };

            this.worker.postMessage(data);
        });
    }

    streamSave()
    {
        this.generatedChunks    = [];
        this.saveBlobArray      = [];
        this.saveBinary         = '';

        this.writeHeader();
        this.saveBlobArray.push(this.flushToUint8Array());

        this.saveBinary        += this.writeInt(0, false); // This is a reservation for the inflated length ;)

        return this.generateChunks();
    }

    generateChunks()
    {
        if(this.header.saveVersion >= 29)
        {
            return this.generateLevelChunks();
        }

        return this.generateOldChunks();
    }


    /*
     * VERSION 29
     */
    generateLevelChunks(currentLevel = 0)
    {
        if(currentLevel === 0)
        {
            this.saveBinary += this.writeInt((this.levels.length - 1), false);
        }

        let currentLevelName = this.levels[currentLevel].replace('Level ', '');
            if(currentLevel < (this.levels.length - 1)) // Do not write the level mapName
            {
                this.saveBinary += this.writeString(this.levels[currentLevel], false);

                currentLevelName = currentLevelName.split(':');
                currentLevelName.pop();
                currentLevelName = currentLevelName[0].split('.').pop();
            }

        this.postWorkerMessage({command: 'requestObjectKeys', levelName: currentLevelName}).then((objectKeys) => {
            this.postWorkerMessage({command: 'requestCollectables', levelName: currentLevelName}).then((collectables) => {
                return this.generateObjectsChunks(currentLevel, objectKeys, collectables);
            });
        });
    }

    generateObjectsChunks(currentLevel, objectKeys, collectables, step = 0, tempSaveBinaryLength = 0)
    {
        if(step === 0)
        {
            this.saveBinaryReplacer.push({
                key     : currentLevel + '-objectsSaveBinaryLength',
                location: this.saveBinary.length,
            });

            this.saveBinary            += this.writeInt(0, false);
            this.saveBinary            += this.writeInt(objectKeys.length, false);
            tempSaveBinaryLength       += 4; // countObjects
        }

        let objectKeySpliced = objectKeys.slice(step, (step + this.stepsLength));
            if(objectKeySpliced.length > 0)
            {
                return this.postWorkerMessage({command: 'requestObjects', objectKeys: objectKeySpliced}).then((objects) => {
                    let countObjects = objects.length;
                        for(let i = 0; i < countObjects; i++)
                        {
                            if(objects[i].outerPathName !== undefined)
                            {
                                this.saveBinary        += this.writeObject(objects[i]);
                                tempSaveBinaryLength   += this.currentEntityLength;
                            }
                            else
                            {
                                this.saveBinary        += this.writeActor(objects[i]);
                                tempSaveBinaryLength   += this.currentEntityLength;
                            }

                            // Only show progress for the main level
                            if(i % 1000 === 0 && currentLevel === (this.levels.length - 1))
                            {
                                let progress = step / objectKeys.length * 100;
                                    this.worker.postMessage({command: 'loaderMessage', message: 'Compiling %1$s objects (%2$s%)...', replace: [new Intl.NumberFormat(this.language).format(objectKeys.length), Math.round(progress)]});
                                    this.worker.postMessage({command: 'loaderProgress', percentage: (progress * 0.48)});

                                this.pushSaveToChunk();
                            }
                        }

                    return this.generateObjectsChunks(currentLevel, objectKeys, collectables, (step + this.stepsLength), tempSaveBinaryLength);
                });
            }


        this.currentEntityLength    = 0;
        this.saveBinary            += this.generateCollectablesChunks(collectables);
        tempSaveBinaryLength       += this.currentEntityLength;

        this.saveBinaryValues[currentLevel + '-objectsSaveBinaryLength'] = tempSaveBinaryLength;
        this.pushSaveToChunk();

        if(currentLevel === (this.levels.length - 1))
        {
            console.log('Saved ' + objectKeys.length + ' objects...');
        }

        return this.generateEntitiesChunks(currentLevel, objectKeys, collectables);
    }

    generateEntitiesChunks(currentLevel, objectKeys, collectables, step = 0, tempSaveBinaryLength = 0)
    {
        if(step === 0)
        {
            this.saveBinaryReplacer.push({
                key     : currentLevel + '-entitiesSaveBinaryLength',
                location: this.saveBinary.length,
            });

            this.saveBinary            += this.writeInt(0, false);
            this.saveBinary            += this.writeInt(objectKeys.length, false);
            tempSaveBinaryLength       += 4; // countObjects
        }

        let objectKeySpliced = objectKeys.slice(step, (step + this.stepsLength));
            if(objectKeySpliced.length > 0)
            {
                return this.postWorkerMessage({command: 'requestObjects', objectKeys: objectKeySpliced}).then((objects) => {
                    let countObjects = objects.length;
                        for(let i = 0; i < countObjects; i++)
                        {
                            this.saveBinary            += this.writeEntity(objects[i]);
                            tempSaveBinaryLength       += this.currentEntityLength;

                            // Force big entities to deflate to avoid memory error (Mainly foliage removal...)
                            if(this.currentEntityLength >= this.maxChunkSize)
                            {
                                this.pushSaveToChunk();
                            }

                            // Only show progress for the main level
                            if(i % 1000 === 0 && currentLevel === (this.levels.length - 1))
                            {
                                let progress = step / objectKeys.length * 100;
                                    this.worker.postMessage({command: 'loaderMessage', message: 'Compiling %1$s entities (%2$s%)...', replace: [new Intl.NumberFormat(this.language).format(objectKeys.length), Math.round(progress)]});
                                    this.worker.postMessage({command: 'loaderProgress', percentage: (48 + (progress * 0.48))});

                                this.pushSaveToChunk();
                            }
                        }

                    return this.generateEntitiesChunks(currentLevel, objectKeys, collectables, (step + this.stepsLength), tempSaveBinaryLength);
                });
            }

        // Save current level entities
        this.saveBinary        += this.generateCollectablesChunks(collectables);

        this.saveBinaryValues[currentLevel + '-entitiesSaveBinaryLength'] = tempSaveBinaryLength;
        this.pushSaveToChunk();

        if(currentLevel < (this.levels.length - 1))
        {
            return this.generateLevelChunks(currentLevel + 1);
        }
        if(currentLevel === (this.levels.length - 1))
        {
            console.log('Saved ' + objectKeys.length + ' entities...');
        }

        this.pushSaveToChunk();
        return this.finalizeChunks();
    }

    generateCollectablesChunks(collectables)
    {
        let tempSaveBinary  = '';
            tempSaveBinary += this.writeInt(collectables.length, false);
            for(let i = 0; i < collectables.length; i++)
            {
                tempSaveBinary += this.writeObjectProperty(collectables[i], false);
            }

        return tempSaveBinary;
    }


    /*
     * VERSION 28
     */
    generateOldChunks()
    {
        let currentLevel = this.header.mapName;

        this.postWorkerMessage({command: 'requestObjectKeys', levelName: currentLevel}).then((objectKeys) => {
            return this.generateOldObjectsChunks(currentLevel, objectKeys);
        });
    }

    generateOldObjectsChunks(currentLevel, objectKeys, step = 0)
    {
        if(step === 0)
        {
            this.saveBinary += this.writeInt(objectKeys.length, false);
        }

        let objectKeySpliced = objectKeys.slice(step, (step + this.stepsLength));
            if(objectKeySpliced.length > 0)
            {
                return this.postWorkerMessage({command: 'requestObjects', objectKeys: objectKeySpliced}).then((objects) => {
                    let countObjects = objects.length;
                        for(let i = 0; i < countObjects; i++)
                        {
                            if(objects[i].outerPathName === undefined)
                            {
                                this.saveBinary += this.writeActor(objects[i]);
                            }
                            else
                            {
                                this.saveBinary += this.writeObject(objects[i]);
                            }

                            if(i % 1000 === 0)
                            {
                                let progress = step / objectKeys.length * 100;
                                    this.worker.postMessage({command: 'loaderMessage', message: 'Compiling %1$s objects (%2$s%)...', replace: [new Intl.NumberFormat(this.language).format(objectKeys.length), Math.round(progress)]});
                                    this.worker.postMessage({command: 'loaderProgress', percentage: (progress * 0.48)});

                                this.pushSaveToChunk();
                            }
                        }

                    return this.generateOldObjectsChunks(currentLevel, objectKeys, (step + this.stepsLength));
                });
            }

        this.pushSaveToChunk();
        console.log('Saved ' + objectKeys.length + ' objects...');
        return this.generateOldEntitiesChunks(currentLevel, objectKeys);
    }

    generateOldEntitiesChunks(currentLevel, objectKeys, step = 0)
    {
        if(step === 0)
        {
            this.saveBinary += this.writeInt(objectKeys.length, false);
        }

        let objectKeySpliced = objectKeys.slice(step, (step + this.stepsLength));
            if(objectKeySpliced.length > 0)
            {
                return this.postWorkerMessage({command: 'requestObjects', objectKeys: objectKeySpliced}).then((objects) => {
                    let countObjects = objects.length;
                        for(let i = 0; i < countObjects; i++)
                        {
                            this.saveBinary += this.writeEntity(objects[i]);

                            // Force big entities to deflate to avoid memory error (Mainly foliage removal...)
                            if(this.currentEntityLength >= this.maxChunkSize)
                            {
                                this.pushSaveToChunk();
                            }

                            if(i % 1000 === 0)
                            {
                                let progress = step / objectKeys.length * 100;
                                    this.worker.postMessage({command: 'loaderMessage', message: 'Compiling %1$s entities (%2$s%)...', replace: [new Intl.NumberFormat(this.language).format(objectKeys.length), Math.round(progress)]});
                                    this.worker.postMessage({command: 'loaderProgress', percentage: (48 + (progress * 0.48))});

                                this.pushSaveToChunk();
                            }
                        }

                    return this.generateOldEntitiesChunks(currentLevel, objectKeys, (step + this.stepsLength));
                });
            }

        this.pushSaveToChunk();
        console.log('Saved ' + objectKeys.length + ' entities...');

        this.postWorkerMessage({command: 'requestCollectables', levelName: currentLevel}).then((collectables) => {
            this.saveBinary  += this.generateCollectablesChunks(collectables);
            this.pushSaveToChunk();
            return this.finalizeChunks();
        });
    }

    /*
     * CHUNKS HANDLING
     */
    pushSaveToChunk()
    {
        while(this.saveBinary.length >= this.maxChunkSize)
        {
            // Extract extra to be processed later...
            let tempSaveBinary  = this.saveBinary.slice(this.maxChunkSize);
                this.saveBinary = this.saveBinary.slice(0, this.maxChunkSize);
                this.createChunk();
                this.saveBinary = tempSaveBinary;
        }
    }

    finalizeChunks()
    {
        if(this.saveBinary.length > 0)
        {
            this.createChunk();
        }

        console.log('Generated ' + this.generatedChunks.length + ' chunks...');
        this.streamChunks();
    }

    createChunk()
    {
        // Check if we need to replace values afterward...
        let havePlaceholders = [];
            if(this.saveBinaryReplacer.length > 0)
            {
                for(let i = (this.saveBinaryReplacer.length - 1); i >= 0; i--)
                {
                    if(this.saveBinaryReplacer[i].location <= this.saveBinary.length)
                    {
                        havePlaceholders.push(this.saveBinaryReplacer[i]);
                        this.saveBinaryReplacer.splice(i, 1);
                    }
                    else
                    {
                        this.saveBinaryReplacer[i].location -= this.saveBinary.length;
                    }
                }
            }

        let input                       = this.flushToUint8Array();
        let chunk                       = {};
            chunk.uncompressedLength    = input.byteLength;

            if(havePlaceholders.length > 0)
            {
                chunk.toReplace = havePlaceholders;
            }

            // First chunk is not deflated yet as we need to add the total deflated length
            if(this.generatedChunks.length === 0 || chunk.toReplace !== undefined)
            {
                chunk.output = input;

                if(this.generatedChunks.length === 0)
                {
                    chunk.isFirstChunk = true;
                }
            }
            else
            {
                let output = pako.deflate(input);
                    chunk.output            = output;
                    chunk.compressedLength  = output.byteLength;
            }

        this.generatedChunks.push(chunk);
    }

    flushToUint8Array()
    {
        let slice       = this.saveBinary.length;
        let buffer      = new Uint8Array(slice);
            for(let j = 0; j < slice; j++)
            {
                buffer[j] = this.saveBinary.charCodeAt(j) & 0xFF;
            }

        this.saveBinary = '';

        return buffer;
    }

    streamChunks()
    {
        this.worker.postMessage({command: 'loaderMessage', message: 'Generating save file...'});

        while(this.generatedChunks.length > 0)
        {
            let currentChunk = this.generatedChunks.shift();
                if(currentChunk.compressedLength === undefined)
                {
                    if(currentChunk.isFirstChunk !== undefined)
                    {
                        // Update first chunk inflated size
                        let totalInflated = currentChunk.uncompressedLength - 4;
                            for(let i = 0; i < this.generatedChunks.length; i++)
                            {
                                totalInflated += this.generatedChunks[i].uncompressedLength;
                            }

                        currentChunk.output[3]          = (totalInflated >>> 24);
                        currentChunk.output[2]          = (totalInflated >>> 16);
                        currentChunk.output[1]          = (totalInflated >>> 8);
                        currentChunk.output[0]          = (totalInflated & 0xff);
                    }

                    if(currentChunk.toReplace !== undefined)
                    {
                        for(let i = 0; i < currentChunk.toReplace.length; i++)
                        {
                            let replaceValue                            = this.saveBinaryValues[currentChunk.toReplace[i].key];
                            let replacePosition                         = currentChunk.toReplace[i].location;
                                currentChunk.output[replacePosition+3]  = (replaceValue >>> 24);
                                currentChunk.output[replacePosition+2]  = (replaceValue >>> 16);
                                currentChunk.output[replacePosition+1]  = (replaceValue >>> 8);
                                currentChunk.output[replacePosition]    = (replaceValue & 0xff);
                        }
                    }

                    currentChunk.output             = pako.deflate(currentChunk.output);
                    currentChunk.compressedLength   = currentChunk.output.byteLength;
                }

            // Write chunk header
            this.saveBinary = '';
            this.saveBinary += this.writeInt(this.PACKAGE_FILE_TAG);
            this.saveBinary += this.writeInt(0);
            this.saveBinary += this.writeInt(this.maxChunkSize);
            this.saveBinary += this.writeInt(0);
            this.saveBinary += this.writeInt(currentChunk.compressedLength);
            this.saveBinary += this.writeInt(0);
            this.saveBinary += this.writeInt(currentChunk.uncompressedLength);
            this.saveBinary += this.writeInt(0);
            this.saveBinary += this.writeInt(currentChunk.compressedLength);
            this.saveBinary += this.writeInt(0);
            this.saveBinary += this.writeInt(currentChunk.uncompressedLength);
            this.saveBinary += this.writeInt(0);

            this.saveBlobArray.push(this.flushToUint8Array());
            this.saveBlobArray.push(currentChunk.output);
        }

        this.worker.postMessage({command: 'endSaveWriting', blobArray: this.saveBlobArray});
    }



    writeHeader()
    {
        let header  = '';
            header += this.writeInt(this.header.saveHeaderType, false);
            header += this.writeInt(this.header.saveVersion, false);
            header += this.writeInt(this.header.buildVersion, false);
            header += this.writeString(this.header.mapName, false);
            header += this.writeString(this.header.mapOptions, false);
            header += this.writeString(this.header.sessionName, false);
            header += this.writeInt(this.header.playDurationSeconds, false);
            header += this.writeLong(this.header.saveDateTime, false);
            header += this.writeByte(this.header.sessionVisibility, false);

            if(this.header.saveHeaderType >= 7)
            {
                header += this.writeInt(this.header.fEditorObjectVersion, false);
            }
            if(this.header.saveHeaderType >= 8)
            {
                header += this.writeString(this.header.modMetadata, false);
                header += this.writeInt(this.header.isModdedSave, false);
            }
            if(this.header.saveHeaderType >= 10)
            {
                header += this.writeString(this.header.saveIdentifier, false);
            }

        this.saveBinary += header;
    }

    writeObject(currentObject)
    {
        this.currentEntityLength    = 0;
        let object                  = this.writeInt(0, false);
            object                 += this.writeString(currentObject.className, false);
            object                 += this.writeObjectProperty(currentObject, false);
            object                 += this.writeString(currentObject.outerPathName, false);

        return object;
    }

    writeActor(currentActor)
    {
        this.currentEntityLength    = 0;
        let actor                   = this.writeInt(1, false);
            actor                  += this.writeString(currentActor.className, false);
            actor                  += this.writeObjectProperty(currentActor, false);

            if(currentActor.needTransform !== undefined)
            {
                actor += this.writeInt(currentActor.needTransform, false);
            }
            else
            {
                actor += this.writeInt(0, false);
            }

            actor += this.writeFloat(currentActor.transform.rotation[0], false);
            actor += this.writeFloat(currentActor.transform.rotation[1], false);
            actor += this.writeFloat(currentActor.transform.rotation[2], false);
            actor += this.writeFloat(currentActor.transform.rotation[3], false);

            // Enforce bounding on the map to avoid the game from skipping physics!
            if(currentActor.transform.translation[0] < -500000 || currentActor.transform.translation[0] > 500000 || currentActor.transform.translation[1] < -500000 || currentActor.transform.translation[1] > 500000 || currentActor.transform.translation[1] < -500000 || currentActor.transform.translation[1] > 500000)
            {
                currentActor.transform.translation = [0, 0, 2000];
            }

            actor += this.writeFloat(currentActor.transform.translation[0], false);
            actor += this.writeFloat(currentActor.transform.translation[1], false);
            actor += this.writeFloat(currentActor.transform.translation[2], false);

            if(currentActor.transform !== undefined && currentActor.transform.scale3d !== undefined)
            {
                actor += this.writeFloat(currentActor.transform.scale3d[0], false);
                actor += this.writeFloat(currentActor.transform.scale3d[1], false);
                actor += this.writeFloat(currentActor.transform.scale3d[2], false);
            }
            else
            {
                actor += this.writeFloat(1, false);
                actor += this.writeFloat(1, false);
                actor += this.writeFloat(1, false);
            }

            if(currentActor.wasPlacedInLevel !== undefined)
            {
                actor += this.writeInt(currentActor.wasPlacedInLevel, false);
            }
            else
            {
                actor += this.writeInt(0, false);
            }


        return actor;
    }

    writeEntity(currentObject)
    {
        this.currentEntityLength    = 0;
        let entity                  = '';

        if(currentObject.outerPathName === undefined)
        {
            entity += this.writeObjectProperty(currentObject.entity);

            if(currentObject.children !== undefined)
            {
                let countChild  = currentObject.children.length;
                    entity += this.writeInt(countChild);
                    for(let i = 0; i < countChild; i++)
                    {
                        entity += this.writeObjectProperty(currentObject.children[i]);
                    }
            }
            else
            {
                entity += this.writeInt(0);
            }
        }

        if(currentObject.shouldBeNulled !== undefined && currentObject.shouldBeNulled === true)
        {
            return this.writeInt(this.currentEntityLength) + entity;
        }

        entity += this.writeProperties(currentObject, currentObject.className);
        entity += this.writeString('None');

        // Extra properties!
        if(Building_Conveyor.isConveyor(currentObject))
        {
            let itemsLength  = currentObject.extra.items.length;
                     entity += this.writeInt(currentObject.extra.count);
                     entity += this.writeInt(itemsLength);

                for(let i = 0; i < itemsLength; i++)
                {
                    //TODO: Proper langth handle?
                    if(currentObject.extra.items[i].length !== undefined)
                    {
                        entity += this.writeInt(currentObject.extra.items[i].length);
                    }
                    else
                    {
                        entity += this.writeInt(0);
                    }

                    entity += this.writeString(currentObject.extra.items[i].name);
                    // Always empty
                    //entity += this.writeObjectProperty(currentObject.extra.items[i]);
                    entity += this.writeString('');
                    entity += this.writeString('');

                    entity += this.writeFloat(currentObject.extra.items[i].position);
                }
        }
        else
        {
            switch(currentObject.className)
            {
                case '/Game/FactoryGame/-Shared/Blueprint/BP_GameState.BP_GameState_C':
                case '/Game/FactoryGame/-Shared/Blueprint/BP_GameMode.BP_GameMode_C':
                    entity += this.writeInt(currentObject.extra.count);
                    entity += this.writeInt(currentObject.extra.game.length);

                    for(let i = 0; i < currentObject.extra.game.length; i++)
                    {
                        entity += this.writeObjectProperty(currentObject.extra.game[i]);
                    }

                    break;
                case '/Game/FactoryGame/Buildable/Factory/PowerLine/Build_PowerLine.Build_PowerLine_C':
                case '/Game/FactoryGame/Events/Christmas/Buildings/PowerLineLights/Build_XmassLightsLine.Build_XmassLightsLine_C':
                case '/FlexSplines/PowerLine/Build_FlexPowerline.Build_FlexPowerline_C':
                case '/AB_CableMod/Visuals1/Build_AB-PLCopper.Build_AB-PLCopper_C':
                case '/AB_CableMod/Visuals1/Build_AB-PLCaterium.Build_AB-PLCaterium_C':
                case '/AB_CableMod/Visuals3/Build_AB-PLHeavy.Build_AB-PLHeavy_C':
                case '/AB_CableMod/Visuals4/Build_AB-SPLight.Build_AB-SPLight_C':
                case '/AB_CableMod/Visuals3/Build_AB-PLPaintable.Build_AB-PLPaintable_C':
                    entity += this.writeInt(currentObject.extra.count);
                    entity += this.writeObjectProperty(currentObject.extra.source);
                    entity += this.writeObjectProperty(currentObject.extra.target);

                    break;
                case '/Game/FactoryGame/-Shared/Blueprint/BP_CircuitSubsystem.BP_CircuitSubsystem_C':
                    entity += this.writeInt(currentObject.extra.count);
                    entity += this.writeInt(currentObject.extra.circuits.length);

                    for(let i = 0; i < currentObject.extra.circuits.length; i++)
                    {
                        entity += this.writeInt(currentObject.extra.circuits[i].circuitId);
                        entity += this.writeObjectProperty(currentObject.extra.circuits[i]);
                    }

                    break;
                case '/Game/FactoryGame/Buildable/Vehicle/Train/Locomotive/BP_Locomotive.BP_Locomotive_C':
                case '/Game/FactoryGame/Buildable/Vehicle/Train/Wagon/BP_FreightWagon.BP_FreightWagon_C':
                    entity += this.writeInt(currentObject.extra.count);

                    if(currentObject.extra.objects !== undefined)
                    {
                        entity += this.writeInt(currentObject.extra.objects.length);

                        for(let i = 0; i < currentObject.extra.objects.length; i++)
                        {
                            entity += this.writeString(currentObject.extra.objects[i].name);
                            entity += this.writeHex(currentObject.extra.objects[i].unk);
                        }
                    }
                    else
                    {
                        entity += this.writeInt(0);
                    }

                    entity += this.writeObjectProperty(currentObject.extra.previous);
                    entity += this.writeObjectProperty(currentObject.extra.next);

                    break;
                case '/Game/FactoryGame/Buildable/Vehicle/Tractor/BP_Tractor.BP_Tractor_C':
                case '/Game/FactoryGame/Buildable/Vehicle/Truck/BP_Truck.BP_Truck_C':
                case '/Game/FactoryGame/Buildable/Vehicle/Explorer/BP_Explorer.BP_Explorer_C':
                case '/Game/FactoryGame/Buildable/Vehicle/Cyberwagon/Testa_BP_WB.Testa_BP_WB_C':
                case '/Game/FactoryGame/Buildable/Vehicle/Golfcart/BP_Golfcart.BP_Golfcart_C':
                case '/Game/FactoryGame/Buildable/Vehicle/Golfcart/BP_GolfcartGold.BP_GolfcartGold_C':
                    entity += this.writeInt(currentObject.extra.count);
                    entity += this.writeInt(currentObject.extra.objects.length);

                    for(let i = 0; i < currentObject.extra.objects.length; i++)
                    {
                        entity += this.writeString(currentObject.extra.objects[i].name);
                        entity += this.writeHex(currentObject.extra.objects[i].unk);
                    }

                    break;
                default:
                    if(currentObject.missing !== undefined)
                    {
                        entity += this.writeHex(currentObject.missing);
                    }
                    else
                    {
                        entity += this.writeByte(0);
                        entity += this.writeByte(0);
                        entity += this.writeByte(0);
                        entity += this.writeByte(0);
                    }

                    break;
            }
        }

        return this.writeInt(this.currentEntityLength) + entity;
    }
    writeProperties(currentObject, parentType = null)
    {
        let propertiesLength    = currentObject.properties.length;
        let properties          = '';

        for(let i = 0; i < propertiesLength; i++)
        {
            properties += this.writeProperty(currentObject.properties[i], parentType);
        }

        return properties;
    }

    writeProperty(currentProperty, parentType = null)
    {
        let propertyStart   = '';
            propertyStart  += this.writeString(currentProperty.name);
            propertyStart  += this.writeString(currentProperty.type + 'Property');
        let property        = '';


        // Reset to get property length...
        let startCurrentPropertyBufferLength    = this.currentBufferLength;
            this.currentBufferLength            = 0;
            property                            = this.writeInt( ((currentProperty.index !== undefined) ? currentProperty.index : 0), false);

        switch(currentProperty.type)
        {
            case 'Bool':
                property += this.writeByte(currentProperty.value, false);
                property += this.writePropertyGUID(currentProperty);
                break;

            case 'Int8':
                property += this.writePropertyGUID(currentProperty);
                property += this.writeInt8(currentProperty.value);
                break;

            case 'Int':
            case 'UInt32': // Mod?
                property += this.writePropertyGUID(currentProperty);
                property += this.writeInt(currentProperty.value);
                break;

            case 'Int64': //TODO: Use 64bit integer
            case 'UInt64':
                property += this.writePropertyGUID(currentProperty);
                property += this.writeLong(currentProperty.value);
                break;

            case 'Float':
                property += this.writePropertyGUID(currentProperty);
                property += this.writeFloat(currentProperty.value);
                break;

            case 'Double':
                property += this.writePropertyGUID(currentProperty);
                property += this.writeDouble(currentProperty.value);
                break;

            case 'Str':
            case 'Name':
                property += this.writePropertyGUID(currentProperty);
                property += this.writeString(currentProperty.value);
                break;

            case 'Object':
            case 'Interface':
                property += this.writePropertyGUID(currentProperty);
                property += this.writeObjectProperty(currentProperty.value);
                break;

            case 'Enum':
                property += this.writeString(currentProperty.value.name, false);
                property += this.writePropertyGUID(currentProperty);
                property += this.writeString(currentProperty.value.value);
                break;

            case 'Byte':
                property += this.writeString(currentProperty.value.enumName, false);
                property += this.writePropertyGUID(currentProperty);

                if(currentProperty.value.enumName === 'None')
                {
                    property += this.writeByte(currentProperty.value.value);
                }
                else
                {
                    property += this.writeString(currentProperty.value.valueName);
                }
                break;

            case 'Text':
                property += this.writePropertyGUID(currentProperty);
                property += this.writeTextProperty(currentProperty);
                break;

            case 'Array':
                property += this.writeArrayProperty(currentProperty, parentType);
                break;

            case 'Map':
                property += this.writeMapProperty(currentProperty, parentType);
                break;

            case 'Set':
                property += this.writeSetProperty(currentProperty, parentType);
                break;

            case 'Struct':
                property += this.writeStructProperty(currentProperty, parentType);
                break;
        }

        let propertyLength          = parseInt(this.currentBufferLength) || 0; // Prevent NaN
        this.currentBufferLength    = startCurrentPropertyBufferLength + propertyLength;

        return propertyStart + this.writeInt(propertyLength) + property;
    }

    writeArrayProperty(currentProperty, parentType)
    {
        let property                    = '';
        let currentArrayPropertyCount   = currentProperty.value.values.length;
            if(currentProperty.name === 'mFogOfWarRawData')
            {
                currentArrayPropertyCount *= 4;
            }

        property += this.writeString(currentProperty.value.type + 'Property', false);
        property += this.writeByte(0, false);
        property += this.writeInt(currentArrayPropertyCount);

        switch(currentProperty.value.type)
        {
            case 'Byte':
                switch(currentProperty.name)
                {
                    case 'mFogOfWarRawData':
                        for(let i = 0; i < (currentArrayPropertyCount / 4); i++)
                        {
                            property += this.writeByte(0);
                            property += this.writeByte(0);
                            property += this.writeByte(currentProperty.value.values[i]);
                            property += this.writeByte(255);
                        }
                        break;
                    default:
                        property += this.writeBytesArray(currentProperty.value.values);
                }
                break;

            case 'Bool':
                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    property += this.writeByte(currentProperty.value.values[i]);
                }
                break;

            case 'Int':
                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    property += this.writeInt(currentProperty.value.values[i]);
                }
                break;

            case 'Float':
                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    property += this.writeFloat(currentProperty.value.values[i]);
                }
                break;

            case 'Enum':
                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    property += this.writeString(currentProperty.value.values[i].name);
                }
                break;

            case 'Str':
                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    property += this.writeString(currentProperty.value.values[i]);
                }
                break;

            case 'Text':
                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    property += this.writeTextProperty(currentProperty.value.values[i]);
                }
                break;

            case 'Object':
            case 'Interface':
                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    property += this.writeObjectProperty(currentProperty.value.values[i]);
                }
                break;

            case 'Struct':
                let currentBufferStartingLength     = this.currentBufferLength;
                let structPropertyBufferLength      = this.currentEntityLength;

                property += this.writeString(currentProperty.name);
                property += this.writeString('StructProperty');

                let structure   = this.writeInt(0);
                    structure  += this.writeString(currentProperty.structureSubType);

                    structure  += this.writeInt( ((currentProperty.propertyGuid1 !== undefined) ? currentProperty.propertyGuid1 : 0) );
                    structure  += this.writeInt( ((currentProperty.propertyGuid2 !== undefined) ? currentProperty.propertyGuid2 : 0) );
                    structure  += this.writeInt( ((currentProperty.propertyGuid3 !== undefined) ? currentProperty.propertyGuid3 : 0) );
                    structure  += this.writeInt( ((currentProperty.propertyGuid4 !== undefined) ? currentProperty.propertyGuid4 : 0) );

                    structure  += this.writeByte(0);

                let structureSizeLength      = this.currentEntityLength;

                for(let i = 0; i < currentArrayPropertyCount; i++)
                {
                    switch(currentProperty.structureSubType)
                    {
                        case 'InventoryItem': // MOD: FicsItNetworks
                            structure += this.writeInt(currentProperty.value.values[i].unk1);
                            structure += this.writeString(currentProperty.value.values[i].itemName);
                            structure += this.writeObjectProperty(currentProperty.value.values[i]);
                            break;

                        case 'Guid':
                            structure += this.writeHex(currentProperty.value.values[i]);
                            break;

                        case 'FINNetworkTrace': // MOD: FicsIt-Networks
                            structure += this.writeFINNetworkTrace(currentProperty.value.values[i]);
                            break;

                        case 'Vector':
                            structure += this.writeFloat(currentProperty.value.values[i].x);
                            structure += this.writeFloat(currentProperty.value.values[i].y);
                            structure += this.writeFloat(currentProperty.value.values[i].z);
                            break;

                        case 'LinearColor':
                            structure += this.writeFloat(currentProperty.value.values[i].r);
                            structure += this.writeFloat(currentProperty.value.values[i].g);
                            structure += this.writeFloat(currentProperty.value.values[i].b);
                            structure += this.writeFloat(currentProperty.value.values[i].a);
                            break;


                        // MOD: FicsIt-Networks
                        case 'FINGPUT1BufferPixel':
                            structure += this.writeFINGPUT1BufferPixel(currentProperty.value.values[i]);
                            break;

                        default:
                            for(let j = 0; j < currentProperty.value.values[i].length; j++)
                            {
                                structure += this.writeProperty(currentProperty.value.values[i][j]);
                            }
                            structure += this.writeString('None');
                            break;
                    }
                }

                property += this.writeInt(this.currentEntityLength - structureSizeLength);
                property += structure;

                this.currentBufferLength = currentBufferStartingLength + (this.currentEntityLength - structPropertyBufferLength);

                break;
            default:
                console.log('Missing ' + currentProperty.value.type + ' in ArrayProperty ' + currentProperty.name);
                break;
        }

        return property;
    }

    writeMapProperty(currentProperty, parentType)
    {
        let property                = '';
        let currentMapPropertyCount = currentProperty.value.values.length;

        property += this.writeString(currentProperty.value.keyType + 'Property', false);
        property += this.writeString(currentProperty.value.valueType + 'Property', false);
        property += this.writeByte(0, false);
        property += this.writeInt(currentProperty.value.modeType);

        if(currentProperty.value.modeType === 2)
        {
            property += this.writeString(currentProperty.value.modeUnk2);
            property += this.writeString(currentProperty.value.modeUnk3);
        }
        if(currentProperty.value.modeType === 3)
        {
            property += this.writeHex(currentProperty.value.modeUnk1);
            property += this.writeString(currentProperty.value.modeUnk2);
            property += this.writeString(currentProperty.value.modeUnk3);
        }

        property += this.writeInt(currentMapPropertyCount);

        for(let iMapProperty = 0; iMapProperty < currentMapPropertyCount; iMapProperty++)
        {
            switch(currentProperty.value.keyType)
            {
                case 'Int':
                    property += this.writeInt(currentProperty.value.values[iMapProperty].keyMap);
                    break;
                case 'Int64':
                    property += this.writeLong(currentProperty.value.values[iMapProperty].keyMap);
                    break;
                case 'Name':
                case 'Str':
                    property += this.writeString(currentProperty.value.values[iMapProperty].keyMap);
                    break;
                case 'Object':
                    property += this.writeObjectProperty(currentProperty.value.values[iMapProperty].keyMap);
                    break;
                case 'Enum':
                     property += this.writeString(currentProperty.value.values[iMapProperty].keyMap.name);
                    break;
                case 'Struct':
                    if(currentProperty.name === 'Destroyed_Foliage_Transform') // Mod: Universal Destroyer
                    {
                        property += this.writeFloat(currentProperty.value.values[iMapProperty].keyMap.x);
                        property += this.writeFloat(currentProperty.value.values[iMapProperty].keyMap.y);
                        property += this.writeFloat(currentProperty.value.values[iMapProperty].keyMap.z);
                        break;
                    }

                    for(let i = 0; i < currentProperty.value.values[iMapProperty].keyMap.length; i++)
                    {
                        property += this.writeProperty(currentProperty.value.values[iMapProperty].keyMap[i]);
                    }
                    property += this.writeString('None');
                    break;
                default:
                    console.log('Missing keyType ' + currentProperty.value.keyType + ' in ' + currentProperty.name);
            }

            switch(currentProperty.value.valueType)
            {
                case 'Byte':
                    if(currentProperty.value.keyType === 'Str')
                    {
                        property += this.writeString(currentProperty.value.values[iMapProperty].valueMap);
                    }
                    else
                    {
                        property += this.writeByte(currentProperty.value.values[iMapProperty].valueMap);
                    }
                    break;
                case 'Bool':
                    property += this.writeByte(currentProperty.value.values[iMapProperty].valueMap);
                    break;
                case 'Int':
                    property += this.writeInt(currentProperty.value.values[iMapProperty].valueMap);
                    break;
                case 'Float':
                    property += this.writeFloat(currentProperty.value.values[iMapProperty].valueMap);
                    break;
                case 'Str':
                    property += this.writeString(currentProperty.value.values[iMapProperty].valueMap);
                    break;
                case 'Object':
                    property += this.writeObjectProperty(currentProperty.value.values[iMapProperty].valueMap);
                    break;
                case 'Struct':
                    if(parentType === 'LBBalancerData')
                    {
                        property += this.writeInt(currentProperty.value.values[iMapProperty].valueMap.mNormalIndex);
                        property += this.writeInt(currentProperty.value.values[iMapProperty].valueMap.mOverflowIndex);
                        property += this.writeInt(currentProperty.value.values[iMapProperty].valueMap.mFilterIndex);
                    }
                    else
                    {
                        let currentBufferStartingLength     = this.currentBufferLength;
                        let structPropertyBufferLength      = this.currentEntityLength;

                        for(let i = 0; i < currentProperty.value.values[iMapProperty].valueMap.length; i++)
                        {
                            property += this.writeProperty(currentProperty.value.values[iMapProperty].valueMap[i]);
                        }
                        property += this.writeString('None');

                        this.currentBufferLength = currentBufferStartingLength + (this.currentEntityLength - structPropertyBufferLength);
                    }
                    break;
                default:
                    console.log('Missing valueType ' + currentProperty.value.valueType + ' in MapProperty ' + currentProperty.name);
                    break;
            }
        }

        return property;
    }

    writeSetProperty(currentProperty, parentType)
    {
        let property            = '';
        let setPropertyLength   = currentProperty.value.values.length;

        property += this.writeString(currentProperty.value.type + 'Property', false);
        property += this.writeByte(0, false);
        property += this.writeInt(0);
        property += this.writeInt(setPropertyLength);

        for(let iSetProperty = 0; iSetProperty < setPropertyLength; iSetProperty++)
        {
            switch(currentProperty.value.type)
            {
                case 'Object':
                    property += this.writeObjectProperty(currentProperty.value.values[iSetProperty]);
                    break;
                case 'Struct':
                    if(this.header.saveVersion >= 29 && parentType === '/Script/FactoryGame.FGFoliageRemoval')
                    {
                        property += this.writeFloat(currentProperty.value.values[iSetProperty].x);
                        property += this.writeFloat(currentProperty.value.values[iSetProperty].y);
                        property += this.writeFloat(currentProperty.value.values[iSetProperty].z);
                        break;
                    }
                    // MOD: FicsIt-Networks
                    property += this.writeFINNetworkTrace(currentProperty.value.values[iSetProperty]);
                    break;
                case 'Name':  // MOD: Sweet Transportal
                    property += this.writeString(currentProperty.value.values[iSetProperty].name);
                    break;
                case 'Int':  // MOD: ???
                    property += this.writeInt(currentProperty.value.values[iSetProperty].int);
                    break;
                default:
                    console.log('Missing ' + currentProperty.value.type + ' in SetProperty ' + currentProperty.name);
                    break;
            }
        }

        return property;
    }

    writeStructProperty(currentProperty, parentType)
    {
        let property    = '';
            property   += this.writeString(currentProperty.value.type, false);
            property   += this.writeInt(0, false);
            property   += this.writeInt(0, false);
            property   += this.writeInt(0, false);
            property   += this.writeInt(0, false);
            property   += this.writeByte(0, false);

        switch(currentProperty.value.type)
        {
            case 'Color':
                property += this.writeByte(currentProperty.value.values.b);
                property += this.writeByte(currentProperty.value.values.g);
                property += this.writeByte(currentProperty.value.values.r);
                property += this.writeByte(currentProperty.value.values.a);
                break;

            case 'LinearColor':
                property += this.writeFloat(currentProperty.value.values.r);
                property += this.writeFloat(currentProperty.value.values.g);
                property += this.writeFloat(currentProperty.value.values.b);
                property += this.writeFloat(currentProperty.value.values.a);
                break;

            case 'Vector':
            case 'Rotator':
                property += this.writeFloat(currentProperty.value.values.x);
                property += this.writeFloat(currentProperty.value.values.y);
                property += this.writeFloat(currentProperty.value.values.z);
                break;

            case 'Vector2D': // Mod?
                property += this.writeFloat(currentProperty.value.values.x);
                property += this.writeFloat(currentProperty.value.values.y);
                break;

            case 'Quat':
            case 'Vector4':
                property += this.writeFloat(currentProperty.value.values.a);
                property += this.writeFloat(currentProperty.value.values.b);
                property += this.writeFloat(currentProperty.value.values.c);
                property += this.writeFloat(currentProperty.value.values.d);
                break;

            case 'Box':
                property += this.writeFloat(currentProperty.value.min.x);
                property += this.writeFloat(currentProperty.value.min.y);
                property += this.writeFloat(currentProperty.value.min.z);
                property += this.writeFloat(currentProperty.value.max.x);
                property += this.writeFloat(currentProperty.value.max.y);
                property += this.writeFloat(currentProperty.value.max.z);
                property += this.writeByte(currentProperty.value.isValid);
                break;

            case 'RailroadTrackPosition':
                property += this.writeObjectProperty(currentProperty.value);
                property += this.writeFloat(currentProperty.value.offset);
                property += this.writeFloat(currentProperty.value.forward);

                break;

            case 'TimerHandle':
                property += this.writeString(currentProperty.value.handle);

                break;

            case 'Guid': // MOD?
                property += this.writeHex(currentProperty.value.guid);
                break;

            case 'InventoryItem':
                property += this.writeInt(currentProperty.value.unk1, false);
                property += this.writeString(currentProperty.value.itemName);
                property += this.writeObjectProperty(currentProperty.value);

                let oldLength   = this.currentBufferLength;

                for(let i =0; i < currentProperty.value.properties.length; i++)
                {
                    if(currentProperty.value.properties[i] !== null)
                    {
                        property += this.writeProperty(currentProperty.value.properties[i]);
                    }
                }

                this.currentBufferLength = oldLength + 4; // Don't ask why!

                break;

            case 'FluidBox':
                property += this.writeFloat(currentProperty.value.value);
                break;

            case 'SlateBrush': // MOD?
                property += this.writeString(currentProperty.value.unk1);
                break;

            case 'DateTime': // MOD: Power Suit
                property += this.writeLong(currentProperty.value.dateTime);
                break;

            case 'FINNetworkTrace': // MOD: FicsIt-Networks
                property += this.writeFINNetworkTrace(currentProperty.value.values);
                break;
            case 'FINLuaProcessorStateStorage': // MOD: FicsIt-Networks
                property += this.writeFINLuaProcessorStateStorage(currentProperty.value.values);
                break;
            case 'FICFrameRange': // https://github.com/Panakotta00/FicsIt-Cam/blob/c55e254a84722c56e1badabcfaef1159cd7d2ef1/Source/FicsItCam/Public/Data/FICTypes.h#L34
                property += this.writeLong(currentProperty.value.begin);
                property += this.writeLong(currentProperty.value.end);
                break;

            default:
                let currentBufferStartingLength     = this.currentBufferLength;
                let structPropertyBufferLength      = this.currentEntityLength;

                for(let i = 0; i < currentProperty.value.values.length; i++)
                {
                    property += this.writeProperty(currentProperty.value.values[i], currentProperty.value.type);
                }
                property += this.writeString('None');

                this.currentBufferLength = currentBufferStartingLength + (this.currentEntityLength - structPropertyBufferLength);

                break;
        }

        return property;
    }

    writeTextProperty(currentProperty)
    {
        let property  = this.writeInt(currentProperty.flags);
            property += this.writeByte(currentProperty.historyType);

        switch(currentProperty.historyType)
        {
            case 0:
                property += this.writeString(currentProperty.namespace);
                property += this.writeString(currentProperty.key);
                property += this.writeString(currentProperty.value);
                break;
            case 1:
            case 3:
                property += this.writeTextProperty(currentProperty.sourceFmt);
                property += this.writeInt(currentProperty.argumentsCount);

                for(let i = 0; i < currentProperty.argumentsCount; i++)
                {
                    property += this.writeString(currentProperty.arguments[i].name);
                    property += this.writeByte(currentProperty.arguments[i].valueType);

                    switch(currentProperty.arguments[i].valueType)
                    {
                        case 4:
                            property += this.writeTextProperty(currentProperty.arguments[i].argumentValue);
                            break;
                    }
                }
                break;
            case 10:
                property += this.writeTextProperty(currentProperty.sourceText);
                property += this.writeByte(currentProperty.transformType);
                break;
            case 255:
                // Broke during engine upgrade?
                // See: https://github.com/EpicGames/UnrealEngine/blob/4.25/Engine/Source/Runtime/Core/Private/Internationalization/Text.cpp#L894
                if(this.header.buildVersion >= 140822)
                {
                    property += this.writeInt(currentProperty.hasCultureInvariantString);

                    if(currentProperty.hasCultureInvariantString === 1)
                    {
                        property += this.writeString(currentProperty.value);
                    }
                }
                break;
        }

        return property;
    }

    writeObjectProperty(value, count = true)
    {
        let property = '';
            if(value.levelName !== undefined && value.levelName !== this.header.mapName)
            {
                property += this.writeString(value.levelName, count);
                property += this.writeString(value.pathName, count);
            }
            else
            {
                property += this.writeString(this.header.mapName, count);
                property += this.writeString(value.pathName, count);
                //property += this.writeString(this.header.mapName + ':' + value.pathName, count);
            }

        return property;
    }

    writePropertyGUID(value)
    {
        let property = '';
            if(value.propertyGuid !== undefined)
            {
                property += this.writeByte(1, false);
                property += this.writeHex(value.propertyGuid, false);
            }
            else
            {
                property += this.writeByte(0, false);
            }

        return property;
    }



    writeByte(value, count = true)
    {
        if(this.precacheByte === undefined)
        {
            this.precacheByte = [];
        }
        if(this.precacheByte[value] === undefined)
        {
            this.precacheByte[value] = String.fromCharCode(value & 0xff);
        }

        if(count === true)
        {
            this.currentBufferLength += 1;
        }
        this.currentEntityLength += 1;

        return this.precacheByte[value];
        //return String.fromCharCode(value & 0xff);
    }
    writeBytesArray(values, count = true)
    {
        let arrayLength = values.length;
        let saveBinary  = '';
        //let arrayBuffer = new Uint8Array(arrayLength);

        for(let i = 0; i < arrayLength; i++)
        {
            saveBinary += String.fromCharCode(values[i] & 0xff);
            //arrayBuffer[i] = (values[i] & 0xff);
        }

        if(count === true)
        {
            this.currentBufferLength += arrayLength;
        }
        this.currentEntityLength += arrayLength;

        return saveBinary;
        //this.saveBinary += String.fromCharCode.apply(null, arrayBuffer);
    }

    writeHex(value, count = true)
    {
        if(count === true)
        {
            this.currentBufferLength += value.length;
        }
        this.currentEntityLength += value.length;

        return value;
    }

    // https://github.com/feross/buffer/blob/v6.0.3/index.js#L1440
    writeInt8(value, count = true)
    {
        let arrayBuffer     = new Uint8Array(1);
            arrayBuffer[0]  = (value & 0xff);

        if(count === true)
        {
            this.currentBufferLength++;
        }
        this.currentEntityLength++;

        return String.fromCharCode.apply(null, arrayBuffer);
    }

    // https://github.com/feross/buffer/blob/v6.0.3/index.js#L1469
    writeInt(value, count = true)
    {
        let arrayBuffer     = new Uint8Array(4);
            arrayBuffer[3]  = (value >>> 24);
            arrayBuffer[2]  = (value >>> 16);
            arrayBuffer[1]  = (value >>> 8);
            arrayBuffer[0]  = (value & 0xff);

        if(count === true)
        {
            this.currentBufferLength += 4;
        }
        this.currentEntityLength += 4;

        return String.fromCharCode.apply(null, arrayBuffer);
    }

    writeLong(value, count = true)
    {
        if(value instanceof Array)
        {
            let property  = this.writeInt(value[0], count);
                property += this.writeInt(value[1], count);

                return property;
        }
        else
        {
            let property  = this.writeInt(value, count);
                property += this.writeInt(0, count);

                return property;
        }
    }

    writeFloat(value, count = true)
    {
        let arrayBuffer     = new ArrayBuffer(4);
        let dataView        = new DataView(arrayBuffer);
            dataView.setFloat32(0, value, true);

        if(count === true)
        {
            this.currentBufferLength += 4;
        }
        this.currentEntityLength += 4;

        return String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
    }
    writeDouble(value, count = true)
    {
        let arrayBuffer     = new ArrayBuffer(8);
        let dataView        = new DataView(arrayBuffer);
            dataView.setFloat64(0, value, true);

        if(count === true)
        {
            this.currentBufferLength += 8;
        }
        this.currentEntityLength += 8;

        return String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
    }

    writeString(value, count = true)
    {
        let stringLength = value.length;
            if(stringLength === 0)
            {
                return this.writeInt(0, count);
            }

        // UTF8
        if(/^[\x00-\x7F]*$/.test(value) === true)
        {
            let saveBinary  = this.writeInt(stringLength + 1, count);
                saveBinary += value;
                saveBinary += this.writeByte(0, count);

            if(count === true)
            {
                this.currentBufferLength += stringLength;
            }
            this.currentEntityLength += stringLength;

            return saveBinary;
        }
        // UTF16
        else
        {
            let saveBinary      = this.writeInt(-stringLength - 1, count);
            let arrayBuffer     = new Uint8Array(stringLength * 2);
                for(let i = 0; i < stringLength; i++)
                {
                    arrayBuffer[i * 2]      = value.charCodeAt(i) & 0xff;
                    arrayBuffer[i * 2 + 1]  = (value.charCodeAt(i) >> 8) & 0xff;
                }

            if(count === true)
            {
                this.currentBufferLength += stringLength * 2;
            }
            this.currentEntityLength += stringLength * 2;

            saveBinary += String.fromCharCode.apply(null, arrayBuffer);
            saveBinary += this.writeByte(0, count);
            saveBinary += this.writeByte(0, count);

            return saveBinary;
        }
    }

    writeFINGPUT1BufferPixel(value)
    {
        let saveBinary  = '';
            saveBinary += this.writeHex(value.character);
            saveBinary += this.writeFloat(value.foregroundColor.r);
            saveBinary += this.writeFloat(value.foregroundColor.g);
            saveBinary += this.writeFloat(value.foregroundColor.b);
            saveBinary += this.writeFloat(value.foregroundColor.a);
            saveBinary += this.writeFloat(value.backgroundColor.r);
            saveBinary += this.writeFloat(value.backgroundColor.g);
            saveBinary += this.writeFloat(value.backgroundColor.b);
            saveBinary += this.writeFloat(value.backgroundColor.a);

        return saveBinary;
    }

    writeFINNetworkTrace(value)
    {
        let saveBinary  = '';
            saveBinary += this.writeObjectProperty(value);

            if(value.prev !== undefined)
            {
                saveBinary += this.writeInt(1);
                saveBinary += this.writeFINNetworkTrace(value.prev);
            }
            else
            {
                saveBinary += this.writeInt(0);
            }

            if(value.step !== undefined)
            {
                saveBinary += this.writeInt(1);
                saveBinary += this.writeString(value.step);
            }
            else
            {
                saveBinary += this.writeInt(0);
            }

        return saveBinary;
    };

    writeFINLuaProcessorStateStorage(value)
    {
        let saveBinary  = '';

            saveBinary += this.writeInt(value.trace.length);
            for(let i = 0; i < value.trace.length; i++)
            {
                saveBinary += this.writeFINNetworkTrace(value.trace[i]);
            }

            saveBinary += this.writeInt(value.reference.length);
            for(let i = 0; i < value.reference.length; i++)
            {
                saveBinary += this.writeString(value.reference[i].levelName);
                saveBinary += this.writeString(value.reference[i].pathName);
            }

            saveBinary += this.writeString(value.thread);
            saveBinary += this.writeString(value.globals);

            saveBinary += this.writeInt(value.structs.length);
            for(let i = 0; i < value.structs.length; i++)
            {
                saveBinary += this.writeInt(value.structs[i].unk1);
                saveBinary += this.writeString(value.structs[i].unk2);

                switch(value.structs[i].unk2)
                {
                    case '/Script/CoreUObject.Vector':
                        saveBinary += this.writeFloat(value.structs[i].x);
                        saveBinary += this.writeFloat(value.structs[i].y);
                        saveBinary += this.writeFloat(value.structs[i].z);
                        break;
                    case '/Script/CoreUObject.LinearColor':
                        saveBinary += this.writeFloat(value.structs[i].r);
                        saveBinary += this.writeFloat(value.structs[i].g);
                        saveBinary += this.writeFloat(value.structs[i].b);
                        saveBinary += this.writeFloat(value.structs[i].a);
                        break;
                    case '/Script/FactoryGame.InventoryStack':
                        saveBinary += this.writeInt(value.structs[i].unk3);
                        saveBinary += this.writeString(value.structs[i].unk4);
                        saveBinary += this.writeInt(value.structs[i].unk5);
                        saveBinary += this.writeInt(value.structs[i].unk6);
                        saveBinary += this.writeInt(value.structs[i].unk7);
                        break;
                    case '/Script/FactoryGame.ItemAmount':
                        saveBinary += this.writeInt(value.structs[i].unk3);
                        saveBinary += this.writeString(value.structs[i].unk4);
                        saveBinary += this.writeInt(value.structs[i].unk5);
                        break;
                    case '/Script/FicsItNetworks.FINTrackGraph':
                        saveBinary += this.writeFINNetworkTrace(value.structs[i].trace);
                        saveBinary += this.writeInt(value.structs[i].trackId);
                        break;
                    case '/Script/FicsItNetworks.FINGPUT1Buffer':
                        saveBinary += this.writeInt(value.structs[i].x);
                        saveBinary += this.writeInt(value.structs[i].y);
                        saveBinary += this.writeInt(value.structs[i].size);
                        saveBinary += this.writeString(value.structs[i].name);
                        saveBinary += this.writeString(value.structs[i].type);
                        saveBinary += this.writeInt(value.structs[i].length);

                        for(let size = 0; size < value.structs[i].size; size++)
                        {
                            saveBinary += this.writeFINGPUT1BufferPixel(value.structs[i].buffer[size]);
                        }

                        saveBinary += this.writeHex(value.structs[i].unk3);
                        break;
                }
            }

        return saveBinary;
    }
};

self.onmessage = function(e){
    if(e.data.command !== undefined)
    {
        self.saveParserWrite.handleWorkerMessage(e.data);
    }
    else
    {
        return new SaveParser_Write(self, e.data);
    }
};