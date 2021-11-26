/* global gtag */
import SubSystem_Railroad                       from '../SubSystem/Railroad.js';

export default class BaseLayout_Selection_Copy
{
    constructor(options)
    {
        this.baseLayout         = options.baseLayout;
        this.markersSelected    = options.markersSelected;

        let header              = this.baseLayout.saveGameParser.getHeader();
            this.clipboard      = {
                saveVersion             : header.saveVersion,
                buildVersion            : header.buildVersion,
                data                    : [],
                pipes                   : {},
                hiddenConnections       : {}
            };
            this.baseLayout.clipboard = null;

        if(typeof gtag === 'function')
        {
            gtag('event', 'Copy', {event_category: 'Selection'});
        }

        return this.copy();
    }

    copy()
    {
        if(this.markersSelected)
        {
            let availablePathName   = [];
            let trainTimeTables     = [];

            // Filter not wanted
            for(let i = (this.markersSelected.length - 1); i >= 0; i--)
            {
                let currentObject       = this.baseLayout.saveGameParser.getTargetObject(this.markersSelected[i].options.pathName);
                let currentObjectData   = this.baseLayout.getBuildingDataFromClassName(currentObject.className);

                // We use that to actually map the caves
                if(this.baseLayout.useDebug === true && currentObject.className === '/Game/FactoryGame/Equipment/Beacon/BP_Beacon.BP_Beacon_C')
                {
                    console.log([Math.round(currentObject.transform.translation[0]), Math.round(currentObject.transform.translation[1])]);
                }

                if(currentObjectData !== null)
                {
                    if(currentObjectData.className === '/Game/FactoryGame/Buildable/Factory/TradingPost/Build_TradingPost.Build_TradingPost_C')
                    {
                        this.markersSelected.splice(i, 1);
                        continue;
                    }
                    if(currentObjectData.className === '/Game/FactoryGame/Buildable/Factory/SpaceElevator/Build_SpaceElevator.Build_SpaceElevator_C')
                    {
                        this.markersSelected.splice(i, 1);
                        continue;
                    }
                    if(currentObject.className !== '/Game/FactoryGame/Buildable/Factory/Train/Track/Build_RailroadTrackIntegrated.Build_RailroadTrackIntegrated_C' && currentObject.className.includes('Integrated'))
                    {
                        this.markersSelected.splice(i, 1);
                        continue;
                    }
                }
                else
                {
                    if(
                            currentObject.className !== '/Script/FactoryGame.FGItemPickup_Spawnable'
                         && currentObject.className !== '/Game/FactoryGame/Resource/BP_ItemPickup_Spawnable.BP_ItemPickup_Spawnable_C'
                         && currentObject.className !== '/Game/FactoryGame/Equipment/Decoration/BP_Decoration.BP_Decoration_C'
                         && currentObject.className !== '/Game/FactoryGame/Equipment/PortableMiner/BP_PortableMiner.BP_PortableMiner_C'
                         //&& currentObject.className !== '/Game/FactoryGame/Equipment/Beacon/BP_Beacon.BP_Beacon_C' //TODO: Check if working?
                    )
                    {
                        this.markersSelected.splice(i, 1);
                    }
                }
            }

            for(let i = 0; i < this.markersSelected.length; i++)
            {
                let currentObject       = this.baseLayout.saveGameParser.getTargetObject(this.baseLayout.markersSelected[i].options.pathName);
                let currentObjectData   = this.baseLayout.getBuildingDataFromClassName(currentObject.className);

                if(
                        currentObjectData !== null
                     || currentObject.className === '/Script/FactoryGame.FGItemPickup_Spawnable'
                     || currentObject.className === '/Game/FactoryGame/Resource/BP_ItemPickup_Spawnable.BP_ItemPickup_Spawnable_C'
                     || currentObject.className === '/Game/FactoryGame/Equipment/Decoration/BP_Decoration.BP_Decoration_C'
                     || currentObject.className === '/Game/FactoryGame/Equipment/PortableMiner/BP_PortableMiner.BP_PortableMiner_C'
                     || currentObject.className === '/Game/FactoryGame/Buildable/Factory/DroneStation/BP_DroneTransport.BP_DroneTransport_C' // Skip them and grab them from the port...
                )
                {
                    let newDataObject           = {};
                        newDataObject.parent    = JSON.parse(JSON.stringify(currentObject));
                        newDataObject.children  = [];

                    // Get object children
                    if(currentObject.children !== undefined)
                    {
                        for(let j = 0; j < currentObject.children.length; j++)
                        {
                            let newObjectChildren = JSON.parse(JSON.stringify(this.baseLayout.saveGameParser.getTargetObject(currentObject.children[j].pathName)));
                                newDataObject.children.push(newObjectChildren);
                        }
                    }

                    // Need some extra linked properties?
                    //TODO: Check mPairedStation?
                    let extraProperties = ['mRailroadTrack', 'mInfo', 'mStationDrone'];
                        for(let j = 0; j < extraProperties.length; j++)
                        {
                            let extraProperty   = this.baseLayout.getObjectProperty(currentObject, extraProperties[j]);
                                if(extraProperty !== null)
                                {
                                    let extraPropertyObject = this.baseLayout.saveGameParser.getTargetObject(extraProperty.pathName);
                                        if(extraPropertyObject !== null)
                                        {
                                            let extraPropertyNewObject          = {};
                                                extraPropertyNewObject.parent   = JSON.parse(JSON.stringify(extraPropertyObject));
                                                extraPropertyNewObject.children = [];

                                                if(extraPropertyObject.children !== undefined)
                                                {
                                                    for(let k = 0; k < extraPropertyObject.children.length; k++)
                                                    {
                                                        extraPropertyNewObject.children.push(
                                                            JSON.parse(JSON.stringify(this.baseLayout.saveGameParser.getTargetObject(extraPropertyObject.children[k].pathName)))
                                                        );
                                                    }
                                                }

                                                // Removes drone action to reset it
                                                if(extraPropertyNewObject.className === '/Game/FactoryGame/Buildable/Factory/DroneStation/BP_DroneTransport.BP_DroneTransport_C')
                                                {
                                                    this.baseLayout.setObjectProperty(extraPropertyNewObject.parent, 'mCurrentDockingState', {
                                                        type    : "DroneDockingStateInfo",
                                                        values  : [
                                                            {
                                                                name    : "State",
                                                                type    : "EnumProperty",
                                                                value   : {
                                                                    name    : "EDroneDockingState",
                                                                    value   : "EDroneDockingState::DS_DOCKED"
                                                                }
                                                            }
                                                        ]
                                                    }, 'StructProperty');
                                                    this.baseLayout.deleteObjectProperty(extraPropertyNewObject.parent, 'mCurrentAction');
                                                    this.baseLayout.deleteObjectProperty(extraPropertyNewObject.parent, 'mActionsToExecute');
                                                }

                                            this.clipboard.data.push(extraPropertyNewObject);
                                            availablePathName.push(extraPropertyNewObject.parent.pathName);
                                        }
                                }
                        }

                    // Does vehicle have a list of waypoints?
                    let mTargetList = this.baseLayout.getObjectProperty(currentObject, 'mTargetList'); // Update 5
                        if(mTargetList === null) //TODO:OLD
                        {
                            mTargetList = this.baseLayout.getObjectProperty(currentObject, 'mTargetNodeLinkedList');
                        }
                        if(mTargetList !== null)
                        {
                            let linkedList = this.baseLayout.saveGameParser.getTargetObject(mTargetList.pathName);

                                if(linkedList !== null)
                                {
                                    let mFirst                      = this.baseLayout.getObjectProperty(linkedList, 'mFirst');
                                    let mLast                       = this.baseLayout.getObjectProperty(linkedList, 'mLast');
                                        newDataObject.linkedList    = linkedList;

                                        if(mFirst !== null && mLast !== null)
                                        {
                                            let firstNode   = this.baseLayout.saveGameParser.getTargetObject(mFirst.pathName);
                                            let lastNode    = this.baseLayout.saveGameParser.getTargetObject(mLast.pathName);
                                                if(firstNode !== null && lastNode !== null)
                                                {
                                                    let checkCurrentNode            = firstNode;
                                                        newDataObject.targetPoints  = [];

                                                        while(checkCurrentNode !== null && checkCurrentNode.pathName !== lastNode.pathName)
                                                        {
                                                            newDataObject.targetPoints.push(checkCurrentNode);

                                                            let mNext               = this.baseLayout.getObjectProperty(checkCurrentNode, 'mNext');
                                                                checkCurrentNode    = null;
                                                                if(mNext !== null)
                                                                {
                                                                    checkCurrentNode = this.baseLayout.saveGameParser.getTargetObject(mNext.pathName);
                                                                }
                                                        }

                                                    newDataObject.targetPoints.push(lastNode);
                                                }
                                        }
                                }
                        }

                    // Handle train/station
                    if([
                        '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainStation.Build_TrainStation_C',
                        '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainDockingStation.Build_TrainDockingStation_C',
                        '/Game/FactoryGame/Buildable/Factory/Train/Station/Build_TrainDockingStationLiquid.Build_TrainDockingStationLiquid_C',
                        '/Game/FactoryGame/Buildable/Vehicle/Train/Locomotive/BP_Locomotive.BP_Locomotive_C'
                    ].includes(newDataObject.parent.className))
                    {
                        let railroadSubSystem   = new SubSystem_Railroad({baseLayout: this.baseLayout});
                        let trainIdentifier     = railroadSubSystem.getObjectIdentifier(newDataObject.parent);
                            if(trainIdentifier !== null)
                            {
                                let trainIdentifierNewObject            = {};
                                    trainIdentifierNewObject.parent     = JSON.parse(JSON.stringify(trainIdentifier));

                                    let haveTimeTable                   = this.baseLayout.getObjectProperty(trainIdentifierNewObject.parent, 'TimeTable');
                                        if(haveTimeTable)
                                        {
                                            trainTimeTables.push(haveTimeTable)
                                        }

                                    // Add (Copy) to name
                                    for(let j = 0; j < trainIdentifierNewObject.parent.properties.length; j++)
                                    {
                                        if(['mTrainName', 'mStationName'].includes(trainIdentifierNewObject.parent.properties[j].name))
                                        {
                                            trainIdentifierNewObject.parent.properties[j].value += ' (Copy)'
                                        }
                                    }

                                    this.clipboard.data.push(trainIdentifierNewObject);
                                    availablePathName.push(trainIdentifierNewObject.parent.pathName);
                            }
                    }

                    // Add object
                    this.clipboard.data.push(newDataObject);
                    availablePathName.push(newDataObject.parent.pathName);
                }
            }

            for(let i = (this.clipboard.data.length - 1); i >= 0; i--)
            {
                if(this.clipboard.data[i].parent.className === '/Game/FactoryGame/Buildable/Factory/Train/SwitchControl/Build_RailroadSwitchControl.Build_RailroadSwitchControl_C')
                {
                    let mControlledConnection = this.baseLayout.getObjectProperty(this.clipboard.data[i].parent, 'mControlledConnection');
                        if(mControlledConnection !== null)
                        {
                            let testPathName    = mControlledConnection.pathName.split('.');
                                testPathName.pop();
                                testPathName    = testPathName.join('.');

                            if(availablePathName.includes(testPathName) === false)
                            {
                                this.clipboard.data.splice(i, 1);
                            }
                        }
                }

                if(this.clipboard.data[i].children !== undefined)
                {
                    for(let j = 0; j < this.clipboard.data[i].children.length; j++)
                    {
                        let currentChildren     = this.clipboard.data[i].children[j];
                        let endWith             = '.' + currentChildren.pathName.split('.').pop();

                        let mConnectedComponent = this.baseLayout.getObjectProperty(currentChildren, 'mConnectedComponent');
                            if(mConnectedComponent !== null)
                            {
                                // Remove belt/hyper pipe connection for objects that aren't in the loop...
                                if(this.baseLayout.availableBeltConnection.includes(endWith) || this.baseLayout.availableHyperPipeConnection.includes(endWith))
                                {
                                    let testPathName    = mConnectedComponent.pathName.split('.');
                                        testPathName.pop();
                                        testPathName    = testPathName.join('.');

                                    if(availablePathName.includes(testPathName) === false)
                                    {
                                        this.baseLayout.deleteObjectProperty(currentChildren, 'mConnectedComponent');
                                    }
                                }

                                // Handle pipes circuits
                                if(this.baseLayout.availablePipeConnection.includes(endWith))
                                {
                                    let testPathName    = mConnectedComponent.pathName.split('.');
                                        testPathName.pop();
                                        testPathName    = testPathName.join('.');

                                        if(availablePathName.includes(testPathName) === false)
                                        {
                                            this.baseLayout.deleteObjectProperty(currentChildren, 'mConnectedComponent');
                                        }
                                        else // mPipeNetworkID
                                        {
                                            let pipeNetworkId = this.baseLayout.getObjectProperty(currentChildren, 'mPipeNetworkID');
                                                if(pipeNetworkId !== null && this.baseLayout.saveGamePipeNetworks[pipeNetworkId] !== undefined)
                                                {
                                                    let currentPipeNetwork = this.baseLayout.saveGameParser.getTargetObject(this.baseLayout.saveGamePipeNetworks[pipeNetworkId]);
                                                        if(this.clipboard.pipes[pipeNetworkId] === undefined)
                                                        {
                                                             this.clipboard.pipes[pipeNetworkId] = {
                                                                 fluid      : this.baseLayout.getObjectProperty(currentPipeNetwork, 'mFluidDescriptor'),
                                                                 interface  : []
                                                             };
                                                        }

                                                    // Check if that pathName is in the current pipe network
                                                    if(currentPipeNetwork !== null)
                                                    {
                                                        let mFluidIntegrantScriptInterfaces = this.baseLayout.getObjectProperty(currentPipeNetwork, 'mFluidIntegrantScriptInterfaces');
                                                            if(mFluidIntegrantScriptInterfaces !== null)
                                                            {
                                                                for(let o = 0; o < mFluidIntegrantScriptInterfaces.values.length; o++)
                                                                {
                                                                    if(mFluidIntegrantScriptInterfaces.values[o].pathName === currentChildren.pathName && this.clipboard.pipes[pipeNetworkId].interface.includes(currentChildren.pathName) === false)
                                                                    {
                                                                        this.clipboard.pipes[pipeNetworkId].interface.push(currentChildren.pathName);
                                                                    }

                                                                    if(mFluidIntegrantScriptInterfaces.values[o].pathName === currentChildren.outerPathName && this.clipboard.pipes[pipeNetworkId].interface.includes(currentChildren.outerPathName) === false)
                                                                    {
                                                                        this.clipboard.pipes[pipeNetworkId].interface.push(currentChildren.outerPathName);
                                                                    }

                                                                    if(mFluidIntegrantScriptInterfaces.values[o].pathName === mConnectedComponent.pathName && this.clipboard.pipes[pipeNetworkId].interface.includes(mConnectedComponent.pathName) === false)
                                                                    {
                                                                        this.clipboard.pipes[pipeNetworkId].interface.push(mConnectedComponent.pathName);
                                                                    }
                                                                }
                                                            }
                                                    }
                                                }
                                        }
                                }
                            }


                        // Remove railway connection for objects that aren't in the loop...
                        let mConnectedComponents = this.baseLayout.getObjectProperty(currentChildren, 'mConnectedComponents');
                            if(mConnectedComponents !== null && this.baseLayout.availableRailwayConnection.includes(endWith))
                            {
                                for(let n = (mConnectedComponents.values.length - 1); n >= 0; n--)
                                {
                                    let testPathName    = mConnectedComponents.values[n].pathName.split('.');
                                        testPathName.pop();
                                        testPathName    = testPathName.join('.');

                                    if(availablePathName.includes(testPathName) === false)
                                    {
                                        mConnectedComponents.values.splice(n, 1);
                                    }
                                }
                            }

                        // Remove platform connection for objects that aren't in the loop...
                        let mConnectedTo = this.baseLayout.getObjectProperty(currentChildren, 'mConnectedTo');
                            if(mConnectedTo !== null && this.baseLayout.availablePlatformConnection.includes(endWith))
                            {
                                let testPathName    = mConnectedTo.pathName.split('.');
                                    testPathName.pop();
                                    testPathName    = testPathName.join('.');

                                if(availablePathName.includes(testPathName) === false)
                                {
                                    this.baseLayout.deleteObjectProperty(currentChildren, 'mConnectedTo');
                                }
                            }
                    }
                }
            }

            // Grab wires when needed, or delete power connection...
            for(let i = 0; i < this.clipboard.data.length; i++)
            {
                if(this.clipboard.data[i].children !== undefined)
                {
                    for(let j = 0; j < this.clipboard.data[i].children.length; j++)
                    {
                        let currentChildren = this.clipboard.data[i].children[j];

                        for(let k = 0; k < this.baseLayout.availablePowerConnection.length; k++)
                        {
                            if(currentChildren.pathName.endsWith(this.baseLayout.availablePowerConnection[k]))
                            {
                                let mWires = this.baseLayout.getObjectProperty(currentChildren, 'mWires');
                                    if(mWires !== null)
                                    {
                                        for(let m = (mWires.values.length - 1); m >= 0; m--)
                                        {
                                            let keepPowerLine    = true;
                                            let currentPowerline = this.baseLayout.saveGameParser.getTargetObject(mWires.values[m].pathName);

                                                if(currentPowerline !== null && currentPowerline.extra !== undefined)
                                                {
                                                    let testSourcePathName  = currentPowerline.extra.sourcePathName.split('.');
                                                        testSourcePathName.pop();
                                                        testSourcePathName  = testSourcePathName.join('.');

                                                    if(availablePathName.includes(testSourcePathName) === false)
                                                    {
                                                        keepPowerLine = false;
                                                    }

                                                    let testTargetPathName  = currentPowerline.extra.targetPathName.split('.');
                                                        testTargetPathName.pop();
                                                        testTargetPathName  = testTargetPathName.join('.');

                                                    if(availablePathName.includes(testTargetPathName) === false)
                                                    {
                                                        keepPowerLine = false;
                                                    }
                                                }
                                                else
                                                {
                                                    keepPowerLine = false;
                                                }

                                                if(keepPowerLine === false)
                                                {
                                                    mWires.values.splice(m, 1);
                                                }
                                                else
                                                {
                                                    if(availablePathName.includes(currentPowerline.pathName) === false)
                                                    {
                                                        this.clipboard.data.push({parent: currentPowerline, children: []});
                                                        availablePathName.push(currentPowerline.pathName);
                                                    }
                                                }
                                        }
                                    }

                                let mHiddenConnections = this.baseLayout.getObjectProperty(currentChildren, 'mHiddenConnections');
                                    if(mHiddenConnections !== null)
                                    {
                                        for(let m = (mHiddenConnections.values.length - 1); m >= 0; m--)
                                        {
                                            let currentHiddenConnection = this.baseLayout.saveGameParser.getTargetObject(mHiddenConnections.values[m].pathName);

                                                if(currentHiddenConnection !== null)
                                                {
                                                        currentHiddenConnection     = JSON.parse(JSON.stringify(currentHiddenConnection));
                                                    let mCurrentHiddenConnections   = this.baseLayout.getObjectProperty(currentHiddenConnection, 'mHiddenConnections');

                                                        if(mCurrentHiddenConnections !== null)
                                                        {
                                                            for(let n = (mCurrentHiddenConnections.values.length - 1); n >= 0; n--)
                                                            {
                                                                let testSourcePathName  = mCurrentHiddenConnections.values[n].pathName.split('.');
                                                                    testSourcePathName.pop();
                                                                    testSourcePathName  = testSourcePathName.join('.');

                                                                    if(availablePathName.includes(testSourcePathName) === false)
                                                                    {
                                                                        mCurrentHiddenConnections.values.splice(n, 1);
                                                                    }
                                                            }
                                                        }

                                                    if(this.clipboard.hiddenConnections[currentHiddenConnection.pathName] === undefined)
                                                    {
                                                        this.clipboard.hiddenConnections[currentHiddenConnection.pathName] = currentHiddenConnection;
                                                    }
                                                }
                                        }
                                    }
                            }
                        }
                    }
                }
            }

            // Handle timetable and remove not copied from them!
            for(let i = 0; i < trainTimeTables.length; i++)
            {
                let timeTable = this.baseLayout.saveGameParser.getTargetObject(trainTimeTables[i].pathName);;
                    if(timeTable !== null)
                    {
                        let newTimeTable    = JSON.parse(JSON.stringify(timeTable));
                        let mStops          = this.baseLayout.getObjectProperty(newTimeTable, 'mStops');
                            if(mStops !== null)
                            {
                                for(let j = (mStops.values.length - 1); j >= 0; j--)
                                {
                                    for(let k = 0; k < mStops.values[j].length; k++)
                                    {
                                        if(mStops.values[j][k].name === 'Station')
                                        {
                                            if(availablePathName.includes(mStops.values[j][k].value.pathName) === false)
                                            {
                                                mStops.values.splice(j, 1);
                                            }
                                        }
                                    }
                                }
                            }

                            this.clipboard.data.push({parent: newTimeTable, children: []});
                            availablePathName.push(newTimeTable.pathName);
                    }
            }

            if(this.baseLayout.useDebug === true)
            {
                console.log('COPY', this.clipboard);
            }

            // Store boundaries
            let selectionBoundaries = this.baseLayout.getSelectionBoundaries(this.markersSelected);
                this.clipboard.minX      = selectionBoundaries.minX;
                this.clipboard.maxX      = selectionBoundaries.maxX;
                this.clipboard.minY      = selectionBoundaries.minY;
                this.clipboard.maxY      = selectionBoundaries.maxY;

            this.baseLayout.clipboard  = JSON.parse(JSON.stringify(this.clipboard));
        }

        this.baseLayout.cancelSelectMultipleMarkers();
    }
}