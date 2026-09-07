import { LifeMap as MapDomain } from "@/domain/lifeMap";
import { View } from "react-native";


interface MapViewModel{
    nodes:NodeViewModel[],
    edges:EdgeViewModel[],
}
interface NodeViewModel{
    x:number;
    y:number;
    title:string;
    color:string;
    shape:string;
}
interface EdgeViewModel{
    x:number;
    y:number;
    title:string;
    shape:string;
}

function mapDomainToViewModel(map:MapDomain){
    let mapViewModel = {
        nodes:[],
        edges:[]
    }
    map.rootNodes
}




// function mapViewModelToDomain(map:MapViewModel){

// }

export default function Map(){
    return <View>

    </View>
}